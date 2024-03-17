import logger from './logger.js'

export async function getLastSeq(
  loki_url: string,
  job_name: string,
): Promise<number> {
  const query =
    'max(last_over_time({job="' +
    job_name +
    '"} | json seq="meta.seq" | unwrap seq [73h]))'

  const response = await fetch(
    `${loki_url}/loki/api/v1/query?query=${query}&step=73h`,
  )

  if (response.status !== 200) {
    logger.error('unable to connect to loki')
    throw new Error('unable to connect to loki')
  }

  const json: any = await response.json()
  let seq: number = 0

  try {
    for (const result of json.data.result) {
      const queriedSeq: number = Number.parseInt(`${result.value[1]}`)
      if (Number.isSafeInteger(queriedSeq) && queriedSeq > seq) {
        seq = queriedSeq
      }
    }
  } catch (e) {
    seq = 0
  }

  logger.info('got last seq from database: ' + seq)

  return seq
}
