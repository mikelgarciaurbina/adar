import path from 'node:path'
import { app } from 'electron'
import { CLI_NAME } from './cli'

/** The `adar` script shipped with this build (packaged: Contents/Resources/bin/adar; dev: resources/bin/adar). */
export function bundledCliPath(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'bin', CLI_NAME) : path.resolve(__dirname, '../../resources/bin', CLI_NAME)
}
