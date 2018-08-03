#!/usr/bin/env node

'use strict';

const consul = require('consul')({promisify: true});
const yargs = require('yargs');
const Redis = require('ioredis');

const argv = yargs
    .option('redis', {
        describe: 'Example: redis://:password@127.0.0.1:6379',
        type: 'string',
        default: 'redis://127.0.0.1:6379',
    })
    .argv;

const redis = new Redis(argv.redis);

async function getServiceBody(data) {

    let {
        name,
        hostname,
        proto = 'tcp',
        port = 0,
        address
    } = data;

    return {
        name,
        tags: [
            `urlprefix-${hostname}/ proto=${proto}`,
        ],
        port: parseInt(port),
        address,
        check: {
            name: `Check port ${port}`,
            tcp: `${address}:${port}`,
            interval: '30s',
            timeout: '1s',
        },
    };

}

async function registerAsService({manifest, info}) {

    let {
        port = 0,
        proto = 'tcp',
    } = manifest.service;

    let hostname = info['host.hostname'];
    let address = info['ip4.addr'];

    let body = await getServiceBody({
        name: hostname,
        hostname,
        port,
        proto,
        address,
    });

    await consul.agent.service.register(body);

    for (let key in manifest.services) {

        let service = key;
        let hostname = `${service}.${info['host.hostname']}`;
        let {
            port = 0,
            proto = 'tcp',
        } = manifest.services[key];

        let body = await getServiceBody({
            name: hostname,
            hostname,
            address,
            port,
            proto,
        });

        await consul.agent.service.register(body);

    }

}

async function serviceDelete({manifest, info}) {

    let services = [];
    services.push(info['host.hostname']);

    for (let key in manifest.services) {

        let hostname = `${key}.${info['host.hostname']}`;
        services.push(hostname);

    }

    services.forEach(async service => {

        try {

            await consul.agent.service.deregister(service);

        } catch (error) {

            console.log('service not registred');
            console.log(error);

        }

    });

}

(async _ => {

    await redis.subscribe(
        'jmaker:containers:started',
        'jmaker:containers:stoped',
    );

    redis.on('message', async (channel, message) => {

        let data = JSON.parse(message);
        let {
            manifest,
            info,
            eventName,
        } = data;

        switch (eventName) {

            case 'started':
                await registerAsService({manifest, info})
                break;

            case 'stoped':
                await serviceDelete({manifest, info})
                break;

        }

    });

})();
