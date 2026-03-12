const puppeteer = require("puppeteer");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const pdfParse = require("pdf-parse");
const cliProgress = require("cli-progress");

let config;
function loadConfig() {
  delete require.cache[require.resolve("./config.json")];
  config = require("./config.json");
  return config;
}

class CrawlerRPA {
  constructor() {
    this.browser = null;
    this.page = null;
    this.startTime = null;
    this.downloadedFiles = [];
    this.progressBar = null;
  }

  async initialize() {
    loadConfig();

    this.startTime = Date.now();
    // if folders exist
    await fs.ensureDir(config.output.directory);
    await fs.ensureDir(path.dirname(config.output.logFile));
    this.browser = await puppeteer.launch({
      headless: config.performance.headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
      ],
    });

    this.page = await this.browser.newPage();
    await this.page.setRequestInterception(true);

    this.page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await this.page.setViewport({ width: 1366, height: 768 });
    await this.page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",);
  }

  async target() {
    try {
      await this.page.goto(config.targetWebsite.url, {
        waitUntil: "networkidle2",
        timeout: config.performance.timeout,
      });
    } catch (err) {
      console.error("❌ Could not open page:", err.message);
    }
  }

  async performSearch() {
    try {
      if (config.targetWebsite.url.includes(".pdf")) {
        await this.page.waitForTimeout(config.performance.waitTime);
        return;
      }

      await this.page.waitForSelector(config.targetWebsite.searchSelector, {
        timeout: config.performance.timeout,
      });

      // clear field
      await this.page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (el && el.value !== undefined) {
          el.value = "";
          el.focus();
        }
      }, config.targetWebsite.searchSelector);

      const canType = await this.page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;

        return (
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.contentEditable === "true"
        );
      }, config.targetWebsite.searchSelector);

      if (canType) {
        await this.page.type(
          config.targetWebsite.searchSelector,
          config.targetWebsite.addressToSearch,
        );

        if (
          config.targetWebsite.searchButtonSelector !==
          config.targetWebsite.searchSelector
        ) {
          await this.page.click(config.targetWebsite.searchButtonSelector);
        }
      }

      // wait for results
      await this.page.waitForTimeout(config.performance.waitTime);
    } catch (err) {
      console.log("Search skipped, continuing...");
    }
  }

  async findPDFLinks() {
    try {
      if (config.targetWebsite.url.includes(".pdf")) {
        const name =
          path.basename(new URL(config.targetWebsite.url).pathname) ||
          "file.pdf";

        return [
          {
            url: config.targetWebsite.url,
            filename: name,
          },
        ];
      }

      const html = await this.page.content();
      const $ = cheerio.load(html);

      const results = [];

      $(config.targetWebsite.pdfLinkSelector).each((i, el) => {
        let href = $(el).attr("href");
        if (!href) return;

        const fullUrl = href.startsWith("http")
          ? href
          : new URL(href, config.targetWebsite.url).href;

        const name =
          path.basename(new URL(fullUrl).pathname) || `doc_${i + 1}.pdf`;

        results.push({
          url: fullUrl,
          filename: name,
        });
      });

      return results;
    } catch (err) {
      console.error("Failed to detect PDFs:", err.message);
    }
  }

  async downloadPDF(pdfInfo) {
    try {
      const res = await axios({
        method: "GET",
        url: pdfInfo.url,
        responseType: "arraybuffer",
        timeout: config.performance.timeout,
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      });

      const filePath = path.join(config.output.directory, pdfInfo.filename);
      await fs.writeFile(filePath, res.data);
      const parsed = await pdfParse(res.data);

      const info = {
        filename: pdfInfo.filename,
        path: filePath,
        size: res.data.length,
        pages: parsed.numpages,
        text: parsed.text.substring(0, 500) + "...",
        downloadTime: Date.now(),
      };

      this.downloadedFiles.push(info);

      return info;
    } catch (err) {
      console.error(`Failed download: ${pdfInfo.filename}`, err.message);
    }
  }

  async downloadAllPDFs(pdfList) {
    if (!pdfList || pdfList.length === 0) {
      console.log("No PDFs found");
      return;
    }

    this.progressBar = new cliProgress.SingleBar({
      format: "Downloading |{bar}| {percentage}% | {value}/{total}",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    });

    this.progressBar.start(pdfList.length, 0);
    const groups = [];

    for (
      let i = 0;
      i < pdfList.length;
      i += config.performance.maxConcurrentDownloads
    ) {
      groups.push(
        pdfList.slice(i, i + config.performance.maxConcurrentDownloads),
      );
    }

    for (const group of groups) {
      const tasks = group.map((file) => this.downloadPDF(file));
      await Promise.all(tasks);
      this.progressBar.update(this.downloadedFiles.length);
    }

    this.progressBar.stop();
  }

  async generateReport() {
    const end = Date.now();
    const totalSeconds = ((end - this.startTime) / 1000).toFixed(2);

    const report = {
      timestamp: new Date().toISOString(),
      totalTime: `${totalSeconds}s`,
      target: config.targetWebsite.url,
      searchTerm: config.targetWebsite.addressToSearch,
      pdfsFound: this.downloadedFiles.length,
      pdfs: this.downloadedFiles,
      performance: {
        targetMet: totalSeconds < 16,
        optimalTarget: totalSeconds < 8,
      },
    };

    const reportPath = path.join(
      config.output.directory,
      `report_${Date.now()}.json`,
    );

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    return report;
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async run() {
    try {
      await this.initialize();

      if (config.targetWebsite.url.includes(".pdf")) {
        const name =
          path.basename(new URL(config.targetWebsite.url).pathname) ||
          "downloaded.pdf";

        await this.downloadAllPDFs([
          { url: config.targetWebsite.url, filename: name },
        ]);
      } else {
        await this.target();
        await this.performSearch();
        const links = await this.findPDFLinks();
        await this.downloadAllPDFs(links);
      }

      return await this.generateReport();
    } catch (err) {
      console.error("Crawler crashed:", err.message);
      throw err;
    } finally {
      await this.cleanup();
    }
  }
}

// Run the crawler
if (require.main === module) {
const crawler = new CrawlerRPA();
crawler.run()
    .then(()=>{
        console.log('\n Crawler finished successfully!');
        process.exit(0);
    })
    .catch(err=>{
        console.error('\n Crawler failed:',err.message);
        process.exit(1);
    });
}

module.exports = CrawlerRPA;
