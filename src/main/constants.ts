import { join } from 'path'
import { homedir } from 'os'

export const CONFIG_DIR = join(homedir(), '.mongolens')
export const CONNECTIONS_FILE = join(CONFIG_DIR, 'connections.json')
export const SETTINGS_FILE = join(CONFIG_DIR, 'settings.json')
