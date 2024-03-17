import logger from './logger.js'

async function checkHealth(url: string, okString: string): Promise<Boolean> {
  try {
    const response = await fetch(url)

    if (response.status !== 200) {
      return false
    }

    const text = await response.text()

    if (text.trim() !== okString.trim()) {
      return false
    }

    logger.verbose(`health: ${url} ok (got '${okString}')`)
    return true
  } catch (e) {
    logger.error(`health: ${url} not ok`)
    throw e
  }
}

export async function checkLokiHealth(url: string): Promise<Boolean> {
  return await checkHealth(`${url}/ready`, 'ready')
}

export async function checkPromHealth(url: string): Promise<Boolean> {
  if (url === '') return true
  return await checkHealth(`${url}/-/ready`, 'Prometheus Server is Ready.')
}
