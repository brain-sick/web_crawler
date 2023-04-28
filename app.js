'use strict';
const {db, queryCountInc, queryCountDec, activeQueries} = require("./db");
const { LEVEL_LIMIT, CRAWL_STATUS} = require("./constants");
const website_crawler_sync = require("./website_crawler");
const log = require('./logger')
require('dotenv').config();

async function fetch_unprocessed_urls(level) {
    return new Promise((resolve, reject) => {
        const query = `select domain, url from ${CRAWL_STATUS} where level=${level} and status=0 LIMIT 50`
        queryCountInc()
        db.query(query, (err, res) => {
            const results = []
            if(err) {
                log.error(`error getting urls at level: ${level}`)
                reject(err)
            }
            else {
                res.forEach(row => {
                    results.push({url: row.url, domain: row.domain})
                })
                resolve(results)
            }
            log.info('query Count: ' + activeQueries())
            queryCountDec()
        })
    })
}

async function get_root_domain(){
    return new Promise((resolve, reject) => {
        const argv = process.argv
        const limit = argv[2]
        const offset = argv[3]
        const query = `select name from domains left outer join ${CRAWL_STATUS} on domains.name = ${CRAWL_STATUS}.domain where domain is NULL LIMIT ${limit} OFFSET ${offset}`
        log.info(`Executing query: ${query}`)
        queryCountInc()
        db.query(query, (err, res) => {
            if(err){
                log.error('error fetching root domain, terminating app')
                process.exit(0)
                reject(err)
            }
            const domains = []
            res.forEach(row => {
                domains.push(row.name)
            })
            queryCountDec()
            resolve(domains)
        });
    })
}

async function processRootDomains() {
    log.info('processing root domains')
    // const root_domains = await get_root_domain();
    const root_domains = ['abc.com']
    for (const domain of root_domains) {
        if(domain.includes(':')) continue
        const url_status_map = await getDomainUrls(domain)
        const event = {body: {domain: domain, level: 0}};
        try {
            // await website_crawler_sync(event, url_status_map);
        } catch (err) {
            log.error('error to process root domains: ' + err)
        }
    }
}

function getDomainUrls(domain) {
    log.info(`Fetching urls for domain: ${domain}`)
    return new Promise(async (resolve, reject) => {
        const query = `select id, domain, url, status from ${CRAWL_STATUS} where domain='${domain}'`
        log.info(`executing query: ${query}`)
        queryCountInc()
        db.query(query, (error, results, _) => {
            if (error) {
                log.error(`getDomainUrl: ${error.message}`)
                queryCountDec()
                reject(error)
            } else {
                const url_status_map = new Map()
                results.forEach(function(row) {
                    if(!url_status_map.has(row.url) || (url_status_map.has(row.url) && url_status_map.get(row.url).status !== 1 && row.status === 1)){
                        url_status_map.set(row.url, {
                            status: row.status,
                            id: row.id
                        });
                    }
                });
                queryCountDec()
                resolve(url_status_map)
            }
        });
    });
}

// check after 4 seconds 4 times
function checkActiveDBQueriesAfterInterval() {
    const interval = 10000
    setTimeout(function() {
        if (activeQueries() === 0) {
            log.info("No more pending db queries, exiting");
            db.end()
        } else {
            log.info("Pending db queries");
        }
    }, interval);
}

async function run() {
    log.info('=====started======')
    const root_domains = await processRootDomains();

    let level = 1
    while(1){
        if (level > LEVEL_LIMIT) {
            break
        }
        const domain_url_list = await fetch_unprocessed_urls(level, root_domains)
        if(domain_url_list.length === 0) {
            level++;
            break
        }

        for(const domain_url of domain_url_list){
            const event = {body: {url: domain_url.url, domain: domain_url.domain, level: level}};
            const url_status_map = await getDomainUrls(domain_url.domain)
            try {
                if(url_status_map.has(domain_url.url) && (url_status_map.get(domain_url.url).status === 1 || url_status_map.get(domain_url.url).status === -1)) {
                    const query = `delete from ${CRAWL_STATUS} where domain="${domain_url.domain}" and url="${domain_url.url}" and status=0`
                    db.query(query, (err, res, fields) => {
                        if(err) log.error(`${domain_url.domain}. url: ${domain_url.url}, err: ${err}`)
                        else{
                            log.info(`${query}, success`)
                            log.info(`repeating ${domain_url.domain}. url: ${domain_url.url} already crawled, deleted status=0`)
                        }
                    })
                    continue
                }
                // -2 to mark that code has touched this url
                const query = `update ${CRAWL_STATUS} set status=-2 where domain='${domain_url.domain}' and url='${domain_url.url}'`
                db.query(query, (err, res, fields) => {
                    if (err) {
                        log.error(`${query}, error: ${err}`)
                        throw new Error(`${err}`)
                    } else {
                        log.info(`${query}, success`)
                    }
                })
                await website_crawler_sync(event, url_status_map);
            } catch (err) {
                log.error('website_crawler_sync error: ' + err)
            }
        }
    }
    log.info("===ending===")
}

run()
