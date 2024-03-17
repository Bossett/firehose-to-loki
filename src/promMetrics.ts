import logger from './logger.js'
import wait from './wait.js'

import express, { Application, Request, Response } from 'express'
import Prometheus from 'prom-client'

import fs from 'fs'
import { Server } from 'http'

import os from 'node:os'

export class PromMetrics {
  private register: Prometheus.Registry
  private app: Application
  private metrics_period: number

  private server: Server

  public metrics: {
    latestSeq: Prometheus.Gauge<string>
    firehoseLag: Prometheus.Gauge<string>
    inboundBandwidth: Prometheus.Counter<string>
    outboundBandwidth: Prometheus.Counter<string>
    usedMem: Prometheus.Gauge<string>
    load_1: Prometheus.Gauge<string>
    load_5: Prometheus.Gauge<string>
    load_15: Prometheus.Gauge<string>
  }

  async destroy() {
    for (const metric of Object.keys(this.metrics)) {
      this.register.removeSingleMetric(metric)
    }
    this.register.clear()
    this.server.closeAllConnections()
  }

  async create(
    app_name: string,
    port: number | string = 8080,
    host: string = '0.0.0.0',
    nic: string = 'eth0',
    period: number | string = 2500,
  ) {
    let listen_port = Number.parseInt(`${port}`)
    if (Number.isNaN(listen_port)) {
      listen_port = 8080
    }

    let metrics_period = Number.parseInt(`${period}`)
    if (Number.isNaN(metrics_period)) {
      metrics_period = 2500
    }

    this.app = express()
    this.register = new Prometheus.Registry()
    this.register.clear()
    this.register.setDefaultLabels({
      app: app_name,
    })

    this.metrics = {
      latestSeq: new Prometheus.Gauge({
        name: 'latest_seq_value',
        help: 'Latest seq value from firehose',
      }),
      firehoseLag: new Prometheus.Gauge({
        name: 'firehost_lag',
        help: 'Time in ms between the last commit and now',
      }),
      inboundBandwidth: new Prometheus.Counter({
        name: 'inbound_bandwidth_bytes',
        help: 'Inbound bandwidth usage in bytes',
      }),
      outboundBandwidth: new Prometheus.Counter({
        name: 'outbound_bandwidth_bytes',
        help: 'Outbound bandwidth usage in bytes',
      }),
      usedMem: new Prometheus.Gauge({
        name: 'used_memory',
        help: 'Used memory',
      }),
      load_1: new Prometheus.Gauge({
        name: 'load_1_min',
        help: '1 minute load average',
      }),
      load_5: new Prometheus.Gauge({
        name: 'load_5_min',
        help: '5 minute load average',
      }),
      load_15: new Prometheus.Gauge({
        name: 'load_15_min',
        help: '15 minute load average',
      }),
    }

    for (const metric of Object.keys(this.metrics)) {
      try {
        this.register.registerMetric(this.metrics[metric])
      } catch (e) {
        console.warn(`got '${e.name}' registering ${this.metrics[metric].name}`)
      }
    }

    this.app.get('/metrics', async (req: Request, res: Response) => {
      try {
        const metrics = await this.register.metrics()
        res.set('Content-Type', Prometheus.register.contentType)
        res.end(metrics)
      } catch (err) {
        res.status(500).end(err)
      }
    })

    const metrics_updating = [
      this.updateBandwidthMetrics(nic),
      this.updateOSMetrics(),
    ]

    this.server = this.app.listen(listen_port, host, function () {
      logger.info(`metrics available at ${host}:${listen_port}/metrics`)
    })

    return this
  }

  public async updateOSMetrics() {
    do {
      const usedMem = process.memoryUsage().rss
      const load = os.loadavg()
      this.metrics.usedMem.set(usedMem)
      this.metrics.load_1.set(load[0])
      this.metrics.load_5.set(load[1])
      this.metrics.load_15.set(load[2])
    } while (await wait(this.metrics_period))
  }

  public async updateBandwidthMetrics(deviceName: string) {
    let rxBytesDiff = 0
    let txBytesDiff = 0
    let shouldUpdate = true

    do {
      const filePath = '/proc/net/dev'

      fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
          logger.error(`Error reading ${filePath}: ${err.message}`)
          return
        }

        let found = false

        const lines = data.split('\n')
        for (const line of lines) {
          const trimmedLine = line.trim()

          const [device, ...stats] = trimmedLine.split(/\s+/)

          if (!device.startsWith(deviceName)) continue

          found = true

          const rxBytes = parseInt(stats[0], 10)
          const txBytes = parseInt(stats[8], 10)

          let rxInc = rxBytes - rxBytesDiff
          let txInc = txBytes - txBytesDiff

          if (rxInc < 0 || txInc < 0) {
            this.metrics.inboundBandwidth.reset()
            this.metrics.outboundBandwidth.reset()

            rxInc = rxBytes
            txInc = txBytes
          }

          this.metrics.inboundBandwidth.inc(rxInc)
          this.metrics.outboundBandwidth.inc(txInc)

          rxBytesDiff = rxBytes
          txBytesDiff = txBytes

          return
        }

        if (!found) {
          logger.error(`nic '${deviceName}' not found, not recording bandwidth`)
          shouldUpdate = false
        }
      })
    } while ((await wait(this.metrics_period)) && shouldUpdate)
  }
}
