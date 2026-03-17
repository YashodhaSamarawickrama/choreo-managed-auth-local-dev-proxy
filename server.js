#!/usr/bin/env node

/**
 * Copyright (c) 2024, WSO2 LLC. (https://www.wso2.com). All Rights Reserved.
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

const express = require('express')
const { createProxyMiddleware } = require('http-proxy-middleware')
const https = require('https')
const commandLineArgs = require('command-line-args')
const winston = require('winston')
const { execSync } = require('child_process')


const cliArgDefinitions = [
    { name: 'choreoAppUrl', alias: 'u', type: String, defaultOption: true },
    { name: 'localAppPort', alias: 'p', type: Number },
    { name: 'proxyPort', alias: 'f', type: Number, defaultValue: 10000 },
    { name: 'logLevel', alias: 'l', type: String, defaultValue: 'info' },
]

const getProxyUrl = function () {
    return `https://localhost:${this.proxyPort}`
}

const getChoreoAppUrl = function () {
    return this.choreoAppUrl
}

const getLocalAppUrl = function () {
    return `http://localhost:${this.localAppPort}`
}

configs = {
    ...commandLineArgs(cliArgDefinitions),
    getChoreoAppUrl,
    getProxyUrl,
    getLocalAppUrl,
}

var logger = new (winston.Logger)({
    transports: [
      new (winston.transports.Console)({
        timestamp: function() {
            return new Date().toISOString()
          },
        formatter: function(options) {
            return options.timestamp() + ' ' +
              winston.config.colorize(options.level, options.level.toUpperCase()) + ' ' +
              (options.message ? options.message : '') +
              (options.meta && Object.keys(options.meta).length ? '\n\t'+ JSON.stringify(options.meta) : '' )
          }
      }),
    ],
    level: configs.logLevel,
  })

function logProvider(provider) {
    const myCustomProvider = {
      log: logger.log,
      debug: logger.debug,
      info: logger.verbose,
      warn: logger.warn,
      error: logger.error,
    }
    return myCustomProvider
  }

const choreoProxy = createProxyMiddleware({
    target: configs.getChoreoAppUrl(),
    changeOrigin: true,
    secure: false,
    onProxyReq: (proxyReq) => {
        if (proxyReq.path.startsWith('/auth')) {
            proxyReq.setHeader('X-Use-Local-Dev-Mode', configs.getProxyUrl())
        }
        logger.info(`Request proxied to ${configs.getChoreoAppUrl()}${proxyReq.path}`)
    },
    ws: false,
    logProvider: logProvider,
    logLevel: configs.logLevel === 'debug' ? 'debug' : 'silent',
})

const localProxy = createProxyMiddleware({
    target: configs.getLocalAppUrl(),
    ws: true,
    timeout: 5000,
    secure: false,
    logProvider: logProvider,
    logLevel: configs.logLevel === 'debug' ? 'debug' : 'silent',
})

const httpsApp = express()

httpsApp.use('/auth', choreoProxy)
httpsApp.use('/choreo-apis', choreoProxy)
httpsApp.use('/', localProxy)

function generateSelfSignedCert() {
    const key = execSync(
        'openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null',
        { encoding: 'utf8' }
    )
    const cert = execSync(
        'openssl req -new -x509 -key /dev/stdin -days 365 -subj "/CN=localhost" 2>/dev/null',
        { input: key, encoding: 'utf8' }
    )
    return { key, cert }
}

var credentials = generateSelfSignedCert()
logger.info('Generated self-signed certificate for localhost')

var httpsServer = https.createServer(credentials, httpsApp)
httpsServer.listen(configs.proxyPort, () => logger.info(`Access your web application on ${configs.getProxyUrl()}`))
