import logger from './logger.js'
import Denque from 'denque'

import wait from './wait.js'

import { Commit } from '@atproto/api/dist/client/types/com/atproto/sync/subscribeRepos.js'
import { Subscription } from '@atproto/xrpc-server'

import { parseCBORandCar } from './parseCBORandCar.js'

export class FirehoseIterable {
  private commitQueue: Denque<Commit> = new Denque()
  private lastCommitTime = 0
  private timeout: number
  private seq: number

  async create(service: string, seq: number, timeout: number) {
    this.timeout = timeout

    if (seq && Number.isSafeInteger(seq)) this.seq = seq
    else this.seq = 0

    logger.info(`firehose starting from seq: ${seq}`)

    const sub = new Subscription({
      service: service,
      method: `com.atproto.sync.subscribeRepos`,

      getParams: () => ({
        cursor: this.seq,
      }),
      validate: (body: any) => body,
    })

    this.readFirehose(sub)

    return this
  }

  async readFirehose(sub: Subscription) {
    for await (const frame of sub) {
      this.commitQueue.push(frame as Commit)
    }
  }

  async *[Symbol.asyncIterator]() {
    const timeout = this.timeout
    const delay = Math.max(Math.floor(timeout / 10), 100)
    let shouldWait = true // wait on startup

    do {
      while (!this.commitQueue.isEmpty()) {
        const commit: any = this.commitQueue.shift()
        const now = Date.now()

        if (commit === undefined) break

        if (!shouldWait && now - this.lastCommitTime > timeout) {
          logger.error(`no events received for ${Math.floor(timeout / 1000)}s`)
          throw new Error('TimeoutWaitingForFirehose')
        }

        this.lastCommitTime = now
        const parsedCommits = await parseCBORandCar(commit)

        for (const parsedCommit of parsedCommits) {
          if (parsedCommit?.meta?.name === 'OutdatedCursor') {
            logger.warn('got outdated cursor, waiting...')
            shouldWait = true
          } else {
            shouldWait = false
            yield parsedCommit
            if (Number.isSafeInteger(parsedCommit?.meta?.seq))
              this.seq = parsedCommit?.meta?.seq
          }
        }
      }
    } while (await wait(delay))
  }
}
