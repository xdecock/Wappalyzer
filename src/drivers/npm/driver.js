'use strict';

const Wappalyzer = require('./wappalyzer');
const request = require('request');
const url = require('url');
const fs = require('fs');
const Browser = require('zombie');

const robotto = require('robotto');
const json = JSON.parse(fs.readFileSync(__dirname + '/apps.json'));

class Driver {
  constructor(pageUrl, options) {
    this.options = Object.assign({}, {
      debug: false,
      delay: 500,
      maxDepth: 3,
      maxUrls: 10,
      maxWait: 3000,
      recursive: false,
      userAgent: 'Mozilla/5.0 (compatible; Wappalyzer)',
    }, options || {});

    this.options.debug = Boolean(this.options.debug);
    this.options.recursive = Boolean(this.options.recursive);
    this.options.delay = this.options.recursive ? parseInt(this.options.delay, 10) : 0;
    this.options.maxDepth = parseInt(this.options.maxDepth, 10);
    this.options.maxUrls = parseInt(this.options.maxUrls, 10);
    this.options.maxWait = parseInt(this.options.maxWait, 10);

    this.origPageUrl = url.parse(pageUrl);
    this.analyzedPageUrls = [];
    this.apps = [];

    this.wappalyzer = new Wappalyzer();

    this.wappalyzer.apps = json.apps;
    this.wappalyzer.categories = json.categories;

    this.wappalyzer.driver.log = (message, source, type) => this.log(message, source, type);
    this.wappalyzer.driver.displayApps = detected => this.displayApps(detected);
  }

  analyze() {
    return this.crawl(this.origPageUrl);
  }

  log(message, source, type) {
    this.options.debug && console.log('[wappalyzer ' + type + ']', '[' + source + ']', message);
  }

  displayApps(detected) {
    Object.keys(detected).forEach(appName => {
      const app = detected[appName];

      var categories = [];

      app.props.cats.forEach(id => {
        var category = {};

        category[id] = json.categories[id].name;

        categories.push(category)
      });

      if ( !this.apps.some(detectedApp => detectedApp.name === app.name) ) {
        this.apps.push({
          name: app.name,
          confidence: app.confidenceTotal.toString(),
          version: app.version,
          icon: app.props.icon || 'default.svg',
          website: app.props.website,
          categories
        });
      }
    });
  }

  fetch(pageUrl, index, depth) {
    return new Promise(resolve => {
      // Return when the URL is a duplicate or maxUrls has been reached
      if ( this.analyzedPageUrls.indexOf(pageUrl.href) !== -1 || this.analyzedPageUrls.length >= this.options.maxUrls ) {
        return resolve();
      }

      this.analyzedPageUrls.push(pageUrl.href);

      this.wappalyzer.log('depth: ' + depth + '; delay: ' + ( this.options.delay * index ) + 'ms; url: ' + pageUrl.href, 'driver');

      const browser = new Browser({
        userAgent: this.options.userAgent,
        waitDuration: this.options.maxWait + 'ms',
      });

      this.sleep(this.options.delay * index)
        .then(() => {
          browser.visit(pageUrl.href, error => {
            if ( !browser.resources['0'] || !browser.resources['0'].response ) {
              this.wappalyzer.log('No response from server', 'browser', 'error');

              return resolve();
            }

            browser.wait()
              .catch(error => this.wappalyzer.log(error.message, 'browser', 'error'))
              .finally(() => {
                const headers = {};

                browser.resources['0'].response.headers._headers.forEach(header => {
                  if ( !headers[header[0]] ){
                    headers[header[0]] = [];
                  }

                  headers[header[0]].push(header[1]);
                });

                const vars = Object.getOwnPropertyNames(browser.window);
                const html = browser.html();
                const scripts = Array.prototype.slice
                  .apply(browser.document.scripts)
                  .filter(s => s.src)
                  .map(s => s.src);
                const wappalyzer = this.wappalyzer;
		request(robotto.getRobotsUrl(pageUrl.href), function(error, response, body) {
		  if (body) {
                    wappalyzer.analyze(pageUrl.hostname, pageUrl.href, {
                      headers,
                      html,
                      env: vars,
                      scripts,
		      robotsTxt: body
                    });
                  } else {
                    wappalyzer.analyze(pageUrl.hostname, pageUrl.href, {
                      headers,
                      html,
                      env: vars,
                      scripts
                    });
                  }
                  const links = browser.body.getElementsByTagName('a');

                  resolve(links);
		})
              });
          });
        });
    });
  }

  crawl(pageUrl, index = 1, depth = 1) {
    return new Promise(resolve => {
      this.fetch(pageUrl, index, depth)
        .then(links => {
          if ( links && Boolean(this.options.recursive) && depth < this.options.maxDepth ) {
            links = Array.from(links)
              .filter(link => link.hostname === this.origPageUrl.hostname)
              .map(link => { link.hash = ''; return link });

            return Promise.all(links.map((link, index) => this.crawl(link, index + 1, depth + 1)));
          } else {
            return Promise.resolve();
          }
        })
        .then(() => resolve(this.apps));
    });
  }

  sleep(ms) {
    return ms ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
  }
};

module.exports = Driver;
