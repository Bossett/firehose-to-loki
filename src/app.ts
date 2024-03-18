import logger from './logger.js'
import { checkLokiHealth, checkPromHealth } from './checkHealth.js'
import { getLastSeq } from './getLastSeqFromLoki.js'

import { FirehoseIterable } from './firehoseIterable.js'
import { PromMetrics } from './promMetrics.js'

import { Logger, createLogger } from 'winston'
import LokiTransport from 'winston-loki'

import dotenv from 'dotenv'
import wait from './wait.js'
import formatDuration from './formatDuration.js'

dotenv.config()

function getRealInt(
  val: number | string | undefined,
  fallback: any = undefined,
) {
  if (Number.isSafeInteger(val)) return val

  const testVal = Number.parseInt(`${val}`)
  if (Number.isSafeInteger(testVal)) return testVal

  return fallback
}

const LOKI_URL = process.env['LOKI_URL'] || 'http://localhost:3100'
const LOKI_USER = process.env['LOKI_USER'] || ''
const LOKI_PASS = process.env['LOKI_PASS'] || ''
const PROM_URL = process.env['PROM_URL'] || ''
const JOB_NAME = process.env['JOB_NAME'] || 'bluesky-firehose'
const SERVICE = process.env['SERVICE'] || 'wss://bsky.network'
const NIC = process.env['NIC'] || 'eth0'
const METRICS_HOST = process.env['METRICS_HOST'] || '0.0.0.0'

const SEQUENCE_TOLERANCE = getRealInt(process.env['SEQUENCE_TOLERANCE'], 1)
const METRICS_PORT = getRealInt(process.env['METRICS_PORT'], 8080)
const HEALTH_CHECK_PERIOD = getRealInt(
  process.env['HEALTH_CHECK_PERIOD'],
  60 * 1000,
)
const LOGGING_PERIOD = getRealInt(process.env['LOGGING_PERIOD'], 5 * 60 * 1000)
const METRICS_PERIOD = getRealInt(process.env['METRICS_PERIOD'], 2.5 * 1000)
const FIREHOSE_TIMEOUT = getRealInt(process.env['FIREHOSE_TIMEOUT'], 10 * 1000)

let metricsServer: PromMetrics
const runIndex = Math.floor(Date.now() / 1000)

logger.info(`starting up (${runIndex}):`)
logger.info(`- Loki URL:       ${LOKI_URL}`)
logger.info(`- Prometheus URL: ${PROM_URL}`)
logger.info(`- metrics port:   ${METRICS_PORT}`)
logger.info(`- NIC:            ${NIC}`)
logger.info(`- job Name:       ${JOB_NAME}`)
logger.info(`- service:        ${SERVICE}`)

async function healthChecks(retries: number = 3) {
  while (
    false ==
    ((await checkLokiHealth(LOKI_URL)) && (await checkPromHealth(PROM_URL)))
  ) {
    if (retries >= 0) {
      logger.warn('health checks failed, waiting to retry...')
      retries--
      await wait(HEALTH_CHECK_PERIOD)
    } else {
      logger.error('regular health checks failed.')
      throw new Error('HealthCheckFailed')
    }
  }

  logger.verbose(`health checks ok.`)
}

const options = {
  transports: [
    new LokiTransport({
      host: LOKI_URL,
      basicAuth:`${LOKI_USER}:${LOKI_PASS}`,
      timeout: 15000,
      onConnectionError: (e) => {
        logger.error(`loki connection error: ${e}`)
        throw new Error('LokiConnectionError')
      },
      clearOnError: false,
      batching: true,
      interval: 1,
    }),
  ],
}

const loki: Logger = createLogger(options)

async function main() {
  if (metricsServer === undefined) {
    metricsServer = await new PromMetrics().create(
      JOB_NAME,
      METRICS_PORT,
      METRICS_HOST,
      NIC,
      METRICS_PERIOD,
    )
  }

  const health = await healthChecks()

  const initialSeq = await getLastSeq(LOKI_URL, JOB_NAME, LOKI_USER, LOKI_PASS)
  const firehose = await new FirehoseIterable().create(
    SERVICE,
    initialSeq,
    FIREHOSE_TIMEOUT,
  )

  let logPeriod = 0
  let commitsProcessed = 0
  let lastCheckTime = 0

  let lastSeq = 0
  let seqWarn = true
  let skippedRecords = 0

  let lastLag = 0
  let lagWarn = true
  let lagWarnings = 0

  for await (const commit of firehose) {
    const seq: number = getRealInt(commit['meta']['seq'], 0)

    if (lastSeq > seq) {
      if (seqWarn) logger.warn(`${lastSeq} greater than ${seq}...`)
      skippedRecords++
      seqWarn = false
      // do something with skipped records if this is an issue
    }

    const sequenceInc = lastSeq > 0 ? seq - lastSeq : 0

    if (sequenceInc > 1) {
      const missing = seq - lastSeq == 2 ? `${seq - 1}` : `${lastSeq}-${seq}`
      logger.warn(`seq increment > 1 (${sequenceInc}) maybe missing ${missing}`)
      if (sequenceInc > SEQUENCE_TOLERANCE) {
        logger.error(
          `sequence drift is out of tolerance (${sequenceInc} > ${SEQUENCE_TOLERANCE})`,
        )
        throw new Error(`SeqSkippedTooFar`)
      }
    }

    seqWarn = true
    lastSeq = seq

    const commitTime = new Date(commit['meta']['time'])

    const date = new Date()

    const now = date.getTime()

    const msSinceLastCheck = now - lastCheckTime
    const firehoseLag = Math.abs(now - commitTime.getTime())

    if (msSinceLastCheck > HEALTH_CHECK_PERIOD) {
      await healthChecks()

      if (logPeriod <= 0) {
        logPeriod = Math.ceil(LOGGING_PERIOD / HEALTH_CHECK_PERIOD)

        const commitsPerSecond =
          commitsProcessed / ((HEALTH_CHECK_PERIOD / 1000) * logPeriod)

        logger.info(
          `processed ${commitsProcessed} commits ${
            skippedRecords > 0 ? `(${skippedRecords} skipped) ` : ''
          }(${commitsPerSecond.toFixed(
            2,
          )}/s, seq: ${seq}, lag: ${formatDuration(firehoseLag)})`,
        )

        if (lastLag > 0 && firehoseLag - lastLag >= FIREHOSE_TIMEOUT) {
          logger.warn(
            `firehose lag is increasing (${formatDuration(
              firehoseLag,
            )} > ${formatDuration(lastLag)})`,
          )

          lagWarnings++
          if (lagWarnings >= 3) {
            logger.error(`firehose lag increasing too fast`)
            throw new Error(`FirehoseLagIncreasing`)
          }
        } else {
          lagWarnings = 0
          lagWarn = false
        }

        lastLag = firehoseLag

        skippedRecords = 0
        commitsProcessed = 0
      } else {
        logPeriod--
      }
      lastCheckTime = now
    }

    commit['meta']['runIndex'] = runIndex

    const commitLog = {
      message: JSON.stringify(commit),
      timestamp: commitTime,
      labels: {
        job: JOB_NAME,
      },
    }

    loki.info(commitLog)

    metricsServer.metrics.latestSeq.set(seq)
    metricsServer.metrics.firehoseLag.set(firehoseLag)

    commitsProcessed = commitsProcessed + 1
  }
}

async function main_loop() {
  do {
    try {
      await main()
    } catch (e) {
      logger.error(`exception '${e.message}' in main loop, restarting...`)
    }
  } while (await wait(HEALTH_CHECK_PERIOD))
}

main()
