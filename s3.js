'use strict';
const AWS = require('aws-sdk');
const {db, queryCountInc, queryCountDec} = require("./db");
const log = require('./logger')
const constants = require('./constants')
const {CRAWL_STATUS} = require("./constants");
require('dotenv').config()

// Initialize the S3 client
const s3 = new AWS.S3({
    // Set your AWS access credentials and region here
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
    region: 'us-east-1',

    // comment above lines and uncomment below lines for localstack testing

    // accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    // secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    // endpoint: 'http://localhost.localstack.cloud:4566',
    // s3ForcePathStyle: true

});

async function uploadDocumentToS3(buffer, filename, domain, url, insertId) {
    if(filename == null) return
    let env = process.env.ENVIRONMENT
    if(env == null || !Object.values(constants.ENV).includes(env))
        env = constants.ENV.DEV

    const directory = `${domain}_${insertId == null ? '': insertId}`
    const s3Key = `${env}/${domain}/${directory}/documents/${filename}`
    queryCountInc()
    s3.upload({
        Bucket: constants.S3_BUCKET_NAME,
        Key: s3Key,
        Body: buffer,
    }, function (err, _)  {
        queryCountDec()
        if(err) {
            log.error(`Document Upload to s3 failed, url:${url}, filename: ${filename}, ${err}`)
        } else {
            log.info(`Document uploaded to s3, url: ${url}, filename: ${filename}`)
        }
    })
}

async function writePageContentToS3(pageContent, domain, url, insertId) {
    // Set the S3 key for the file based on the domain and level
    let env = process.env.ENVIRONMENT
    if(env == null || !Object.values(constants.ENV).includes(env))
        env = 'dev'

    const directory = `${domain}_${insertId == null ? '': insertId}`
    const s3Key = `${env}/${domain}/${directory}/data.txt`

    queryCountInc()
    s3.upload({
            Bucket: constants.S3_BUCKET_NAME,
            Key: s3Key,
            Body: pageContent
        }, function (err, data) {
            queryCountDec()
            if (err) {
                queryCountInc()
                db.query(`update ${CRAWL_STATUS} set log="can't upload to s3: ${err.name}" where domain="${domain}" and url="${url}"`, () => {
                    queryCountDec()
                })
                log.error(`s3 upload error for url ${url}: ${err}`)
            } if (data) {
                let data_loc = data.Location;
                data_loc = data_loc.split('/').slice(0,-1).join('/') + '/';
                queryCountInc()
                db.query(`update ${CRAWL_STATUS} set s3_uri="${data_loc}" where domain="${domain}" and url="${url}"`, (err, result, fields) => {
                    queryCountDec()
                    if(err){
                        queryCountInc()
                        db.query(`update ${CRAWL_STATUS} set log="can't update s3_uri: ${err.name}" where domain="${domain}" and url="${url}"`, () => {
                            queryCountDec()
                        })
                        log.error(`db update error: ${err}`)
                    }
                    else{
                        log.info('s3_uri updated for ' + url)
                    }
                })
                log.info("S3 Upload Success");
            }
        }
    );
}

module.exports = { writePageContentToS3, uploadDocumentToS3 };
