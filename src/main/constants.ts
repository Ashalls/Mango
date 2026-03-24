import { join } from 'path'
import { homedir } from 'os'

export const CONFIG_DIR = join(homedir(), '.mango')
export const CONNECTIONS_FILE = join(CONFIG_DIR, 'connections.json')
export const SETTINGS_FILE = join(CONFIG_DIR, 'settings.json')
export const CHANGELOG_FILE = join(CONFIG_DIR, 'changelog.json')
