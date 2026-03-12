Installation
1. Get the Project
Option A — Clone with Git
git clone https://github.com/Joram-ape/CRAWLING-RPA.git
cd CRAWLING-RPA

Option B — Manual Download
Download the project files
Extract them
Open the folder in terminal

2. Install Dependencies
npm install

This installs all required packages:
-puppeteer
-axios
-cheerio
-pdf-parse
-fs-extra
-cli-progress

npm start

3. Configuration
The crawler behavior is controlled by config.json.
{
  "targetWebsite": {
   "url": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",     
    "searchSelector": "body",
    "searchButtonSelector": "body",
    "pdfLinkSelector": "a[href$='.pdf']",
    "addressToSearch": "sample"
  },
  "performance": {
    "maxConcurrentDownloads": 5,
    "timeout": 15000,
    "waitTime": 2000,
    "headless": true
  },
  "output": {
    "directory": "./downloads",
    "logFile": "./logs/crawler.log"
  }
}
#### Generated Files
- **PDFs**: Saved in `./downloads/` directory

4. Config Explanation
# Target Website
Field	Purpose
url	Website to open
searchSelector	Input field for search
searchButtonSelector	Button to trigger search
pdfLinkSelector	CSS selector to detect PDF links
addressToSearch	Keyword used in search