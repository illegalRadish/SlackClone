import tmp from 'tmp'
import getPort from 'get-port'
import fs from 'fs'
import crypto from 'crypto'
import { Multiaddr } from 'multiaddr'
import { peerIdFromKeys } from '@libp2p/peer-id'
import { createLibp2p, Libp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { mplex } from '@libp2p/mplex'
import { kadDHT } from '@libp2p/kad-dht'
import { createServer } from 'it-ws'
import createHttpsProxyAgent from 'https-proxy-agent'
import OrbitDB from 'orbit-db'
import {create as IPFScreate } from 'ipfs-core'
import {all as filterAll} from '@libp2p/websockets/filters'
import { webSockets } from './websocketOverTor/index'
import { createPeerId } from '../common/testUtils'
import { Tor } from '../torManager'
import os from 'os'
import { test, expect } from '@jest/globals'
import { createCertificatesTestHelper } from './tests/client-server'
import waitForExpect from 'wait-for-expect'
import logger from '../logger'
const log = logger('filetest')

const sleep = async (time = 1000) =>
  await new Promise(resolve => {
    setTimeout(() => {
      //@ts-expect-error
      resolve()
    }, time)
  })

const createTmpDir = () => {
  return tmp.dirSync({ mode: 0o750, prefix: 'TestTmp_', unsafeCleanup: true })
}

function createFile(filePath, size) {
  const stream = fs.createWriteStream(filePath)
  const maxChunkSize = 1048576 // 1MB
  if (size < maxChunkSize) {
    stream.write(crypto.randomBytes(size))
  } else {
    const chunks = Math.floor(size / maxChunkSize)
    for (let i = 0; i < chunks; i++) {
      stream.write(crypto.randomBytes(Math.min(size, maxChunkSize)))
      size -= maxChunkSize
    }
  }
  stream.end()
}

const uploadFile = async (ipfsInstance, filename) => {
  const stream = fs.createReadStream(`./${filename}`, { highWaterMark: 64 * 1024 * 10 })
  const uploadedFileStreamIterable = {
    async* [Symbol.asyncIterator]() {
      for await (const data of stream) {
        yield data
      }
    }
  }

  // Create directory for file
  const dirname = 'uploads'
  await ipfsInstance.files.mkdir(`/${dirname}`, { parents: true })

  console.time(`Writing ${filename} to ipfs`)
  await ipfsInstance.files.write(`/${dirname}/${filename}`, uploadedFileStreamIterable, {
    create: true
  })
  console.timeEnd(`Writing ${filename} to ipfs`)

  let cid
  const entriesLS = ipfsInstance.files.ls(`/${dirname}`)
  for await (const entry of entriesLS) {
    if (entry.name === filename) {
     cid = entry.cid
    }
  }
  return cid
}

const downloadFile = async (ipfsInstance, cid, filename) => {
  console.log(cid, 'cid')
  const stat = await ipfsInstance.files.stat(cid)
  console.log('stat', stat)
  const entries = ipfsInstance.cat(cid)
  console.time('Time between files.cat and first step of iteration')
  const writeStream = fs.createWriteStream(`received${filename}`)
  console.log('before iterating')
  let counter = 1
  for await (const entry of entries) {
    console.log('entry', counter)
    if (counter === 1) {
      console.timeEnd('Time between files.cat and first step of iteration')
    }
    counter++
    await new Promise((resolve, reject) => {
      writeStream.write(entry, err => {
        if (err) {
          console.error(`${filename} download error: ${err}`)
          reject(err)
        }
        //@ts-expect-error
        resolve()
      })
    })
  }
  writeStream.end()
  console.log('after iterating')
  return true
}

test('large file custom setup', async () => {
    let connected = false
    const tunnelPort1 = await getPort()
    const tunnelPort2 = await getPort()
    const controlPort1 = await getPort()
    const controlPort2 = await getPort()
    const torDir1 = createTmpDir()
    const torDir2 = createTmpDir()
    let tor1 = new Tor({
        torPath: '../../3rd-party/tor/linux/tor',
        appDataPath: torDir1.name,
        httpTunnelPort: tunnelPort1,
        authCookie: '',
        controlPort: controlPort1,
        options: {
          env: {
            LD_LIBRARY_PATH: '../../3rd-party/tor/linux/',
            HOME: os.homedir()
          },
          detached: true
        }
      })
    
      let tor2 = new Tor({
        torPath: '../../3rd-party/tor/linux/tor',
        appDataPath: torDir2.name,
        httpTunnelPort: tunnelPort2,
        authCookie: '',
        controlPort: controlPort2,
        options: {
          env: {
            LD_LIBRARY_PATH: '../../3rd-party/tor/linux/',
            HOME: os.homedir()
          },
          detached: true
        }
      })
    
  await Promise.all([tor1.init(), tor2.init()])
  log('SPAWNED TORS')

  const agent1 = createHttpsProxyAgent({
    port: tunnelPort1, host: '127.0.0.1',
  })
  const agent2 = createHttpsProxyAgent({
    port: tunnelPort2, host: '127.0.0.1',
  })

  const targetPort1 = await getPort()
  const targetPort2 = await getPort()

  const hService1 = await tor1.createNewHiddenService({ targetPort: targetPort1 })
  const hService2 = await tor2.createNewHiddenService({ targetPort: targetPort2 })

  log('hservices, addresses:', hService1.onionAddress, hService2.onionAddress)

  const pems = await createCertificatesTestHelper(`${hService1.onionAddress}`, `${hService2.onionAddress}`)

  const filename = `${(Math.random() + 1).toString(36).substring(7)}_largeFile.txt`
  createFile(filename, 73400320) // 70MB // 73400320
  
  const dir1 = createTmpDir()
  const dir2 = createTmpDir()

  const peerId1 = await createPeerId()
  const peerId2 = await createPeerId()
  
  // Custom Libp2p instances
  const p2p1 = await createLibp2p({
    connectionManager: {
      minConnections: 3,
      maxConnections: 8,
      dialTimeout: 120_000,
      maxParallelDials: 10
    },
    peerId: peerId1,
    addresses: {
      listen: [`/dns4/${hService1.onionAddress}/tcp/443/wss`]
    },
    streamMuxers: [mplex()],
    connectionEncryption: [noise()],
    relay: {
      enabled: false,
      hop: {
        enabled: true,
        active: false
      }
    },
    transports: [
        webSockets({
            filter: filterAll,
            websocket: {
                agent: agent1,
                cert: pems.servCert,
                key: pems.servKey,
                ca: pems.ca
            },
            localAddress: `/dns4/${hService1.onionAddress}/tcp/443/wss/p2p/${peerId1.toString()}`,
            targetPort: targetPort1,
            createServer: createServer
            })],
            //@ts-expect-error
    dht: kadDHT(),
    pubsub: gossipsub({ allowPublishToZeroPeers: true }),
  })
  p2p1.addEventListener('peer:connect', async (peer) => {
    const remotePeerId = peer.detail.remotePeer.toString()
    log(`${p2p1.peerId.toString()} connected to ${remotePeerId}`)
    connected = true
  })

  p2p1.addEventListener('peer:disconnect', async (peer) => {
    const remotePeerId = peer.detail.remotePeer.toString()
    log(`${p2p1.peerId.toString()} disconnected from ${remotePeerId}`)
  })

  const p2p2 = await createLibp2p({
    connectionManager: {
      minConnections: 3,
      maxConnections: 8,
      dialTimeout: 120_000,
      maxParallelDials: 10
    },
    peerId: peerId2,
    addresses: {
      listen: [`/dns4/${hService2.onionAddress}/tcp/443/ws`]
    },
    streamMuxers: [mplex()],
    connectionEncryption: [noise()],
    relay: {
      enabled: false,
      hop: {
        enabled: true,
        active: false
      }
    },
    transports: [
    webSockets({
        filter: filterAll,
        websocket: {
            agent: agent2,
            cert: pems.userCert,
            key: pems.userKey,
            ca: pems.ca
        },
        localAddress: `/dns4/${hService2.onionAddress}/tcp/443/wss/p2p/${peerId2.toString()}`,
        targetPort: targetPort2,
        createServer: createServer
        })],
        //@ts-expect-error
    dht: kadDHT(),
    pubsub: gossipsub({ allowPublishToZeroPeers: true }),
  })
  p2p2.addEventListener('peer:connect', async (peer) => {
    const remotePeerId = peer.detail.remotePeer.toString()
    log(`${p2p2.peerId.toString()} connected to ${remotePeerId}`)
    connected = true
  })

  p2p2.addEventListener('peer:disconnect', async (peer) => {
    const remotePeerId = peer.detail.remotePeer.toString()
    log(`${p2p2.peerId.toString()} disconnected from ${remotePeerId}`)
  })

  // Custom IPFS instances
  let ipfs1 = await IPFScreate({
    libp2p: async () => p2p1,
    preload: { enabled: false },
    EXPERIMENTAL: {
      ipnsPubsub: true
    },
    init: {
      privateKey: peerId1
    },
    repo: dir1.name
  })

  let ipfs2 = await IPFScreate({
    libp2p: async () => p2p2,
    preload: { enabled: false },
    EXPERIMENTAL: {
      ipnsPubsub: true
    },
    init: {
      privateKey: peerId2
    },
    repo: dir2.name
  })

  log('CREATED IPFSSS')

  let orbitdb1 = await OrbitDB.createInstance(ipfs1, { directory: dir1.name })
  let orbitdb2 = await OrbitDB.createInstance(ipfs2, { directory: dir2.name })
  log('created orbitdbs')

  try {
    await p2p1.dial(new Multiaddr(`/dns4/${hService2.onionAddress}/tcp/443/wss/p2p/${peerId2.toString()}`))
  } catch (e) {
    log('E DIAL', e.message)
  }
  

  let kev = await orbitdb1.log('kev', {
    accessController: {
      write: ['*']
    }
  })

  const kev2 = await orbitdb2.log('kev', {
    accessController: {
      write: ['*']
    }
  })

  kev.events.on('write', (_address, entry) => {
    log('kev wrote message', entry.payload.value)
  })
  
  kev2.events.on('write', (_address, entry) => {
    log('kev2 wrote message', entry.payload.value)
  })
  
  kev.events.on('replicate.progress', (address, _hash, entry, progress, total) => {
    log('kev replicated:', entry.payload.value)
  })
  
  kev2.events.on('replicate.progress', (address, _hash, entry, progress, total) => {
    log('kev2 replicated:', entry.payload.value)
  })

  
  
  
  await sleep(20000)
  // Send some messages to prove that peers are connected and replicating
  await kev.add('testEntry1')
  await kev.add('testEntry2')
  await kev2.add('testEntry3')

  waitForExpect(() => {
    expect(connected).toEqual(true)
  }, 100_000)

  const cid = await uploadFile(ipfs1, filename)
  const a = await downloadFile(ipfs2, cid, filename)
  waitForExpect(() => {
    expect(a).toEqual(true)
  }, 400_000)

  await orbitdb1.stop()
  await orbitdb2.stop()
  await ipfs1.stop()
  await ipfs2.stop()
  orbitdb1 = null
  orbitdb2 = null
  ipfs1 = null
  ipfs2 = null
  await tor1.kill()
  await tor2.kill()
}, 500_000)
