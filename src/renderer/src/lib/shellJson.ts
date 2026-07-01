// Parse a MongoDB "shell-flavoured" document — the format Mango's document
// editor shows and accepts — into a plain JS value where BSON types are carried
// as Extended-JSON markers ({ $oid }, { $date }, ...). The main process revives
// those markers into real BSON before writing (see serialize.ts:reviveExtended).
//
// This is a strict superset of JSON.parse: any valid JSON parses identically.
// On top of JSON it accepts the shell constructors the editor renders —
// ObjectId(...), ISODate(...)/new Date(...), NumberLong/Int/Decimal(...),
// UUID(...), BinData(...), Timestamp(...) — plus bare (unquoted) object keys and
// trailing commas, so hand-edited documents parse forgivingly.

export class ShellParseError extends Error {}

type ArgValue = string | number | boolean | null

class Parser {
  private i = 0
  private readonly s: string
  constructor(s: string) { this.s = s }

  parse(): unknown {
    this.ws()
    const value = this.value()
    this.ws()
    if (this.i < this.s.length) {
      throw this.error(`Unexpected token '${this.s[this.i]}'`)
    }
    return value
  }

  private error(msg: string): ShellParseError {
    // Report a 1-based line/column so messages line up with the editor gutter.
    let line = 1
    let col = 1
    for (let j = 0; j < this.i && j < this.s.length; j++) {
      if (this.s[j] === '\n') { line++; col = 1 } else { col++ }
    }
    return new ShellParseError(`${msg} (line ${line}, column ${col})`)
  }

  private ws(): void {
    while (this.i < this.s.length) {
      const c = this.s[this.i]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        this.i++
      } else if (c === '/' && this.s[this.i + 1] === '/') {
        // line comment
        this.i += 2
        while (this.i < this.s.length && this.s[this.i] !== '\n') this.i++
      } else if (c === '/' && this.s[this.i + 1] === '*') {
        // block comment
        this.i += 2
        while (this.i < this.s.length && !(this.s[this.i] === '*' && this.s[this.i + 1] === '/')) this.i++
        this.i += 2
      } else {
        break
      }
    }
  }

  private value(): unknown {
    this.ws()
    const c = this.s[this.i]
    if (c === undefined) throw this.error('Unexpected end of input')
    if (c === '{') return this.object()
    if (c === '[') return this.array()
    if (c === '"' || c === "'") return this.string()
    if (c === '-' || (c >= '0' && c <= '9')) return this.number()
    // identifier: literal (true/false/null) or a constructor like ObjectId(...)
    if (this.isIdentStart(c)) return this.identifier()
    throw this.error(`Unexpected token '${c}'`)
  }

  private object(): Record<string, unknown> {
    this.expect('{')
    const obj: Record<string, unknown> = {}
    this.ws()
    if (this.s[this.i] === '}') { this.i++; return obj }
    for (;;) {
      this.ws()
      const key = this.key()
      this.ws()
      this.expect(':')
      obj[key] = this.value()
      this.ws()
      const ch = this.s[this.i]
      if (ch === ',') {
        this.i++
        this.ws()
        if (this.s[this.i] === '}') { this.i++; return obj } // trailing comma
        continue
      }
      if (ch === '}') { this.i++; return obj }
      throw this.error("Expected ',' or '}'")
    }
  }

  private array(): unknown[] {
    this.expect('[')
    const arr: unknown[] = []
    this.ws()
    if (this.s[this.i] === ']') { this.i++; return arr }
    for (;;) {
      arr.push(this.value())
      this.ws()
      const ch = this.s[this.i]
      if (ch === ',') {
        this.i++
        this.ws()
        if (this.s[this.i] === ']') { this.i++; return arr } // trailing comma
        continue
      }
      if (ch === ']') { this.i++; return arr }
      throw this.error("Expected ',' or ']'")
    }
  }

  private key(): string {
    const c = this.s[this.i]
    if (c === '"' || c === "'") return this.string()
    if (this.isIdentStart(c)) {
      const start = this.i
      while (this.i < this.s.length && this.isIdentPart(this.s[this.i])) this.i++
      return this.s.slice(start, this.i)
    }
    throw this.error('Expected property name')
  }

  private string(): string {
    const quote = this.s[this.i]
    this.i++ // opening quote
    let out = ''
    while (this.i < this.s.length) {
      const c = this.s[this.i]
      if (c === quote) { this.i++; return out }
      if (c === '\\') {
        this.i++
        const e = this.s[this.i]
        switch (e) {
          case '"': out += '"'; break
          case "'": out += "'"; break
          case '\\': out += '\\'; break
          case '/': out += '/'; break
          case 'b': out += '\b'; break
          case 'f': out += '\f'; break
          case 'n': out += '\n'; break
          case 'r': out += '\r'; break
          case 't': out += '\t'; break
          case 'u': {
            const hex = this.s.slice(this.i + 1, this.i + 5)
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw this.error('Invalid \\u escape')
            out += String.fromCharCode(parseInt(hex, 16))
            this.i += 4
            break
          }
          default: throw this.error(`Invalid escape '\\${e ?? ''}'`)
        }
        this.i++
      } else {
        out += c
        this.i++
      }
    }
    throw this.error('Unterminated string')
  }

  private number(): number {
    const start = this.i
    if (this.s[this.i] === '-') this.i++
    while (this.i < this.s.length && /[0-9]/.test(this.s[this.i])) this.i++
    if (this.s[this.i] === '.') {
      this.i++
      while (this.i < this.s.length && /[0-9]/.test(this.s[this.i])) this.i++
    }
    if (this.s[this.i] === 'e' || this.s[this.i] === 'E') {
      this.i++
      if (this.s[this.i] === '+' || this.s[this.i] === '-') this.i++
      while (this.i < this.s.length && /[0-9]/.test(this.s[this.i])) this.i++
    }
    const text = this.s.slice(start, this.i)
    const n = Number(text)
    if (Number.isNaN(n)) throw this.error(`Invalid number '${text}'`)
    return n
  }

  private identifier(): unknown {
    const start = this.i
    while (this.i < this.s.length && this.isIdentPart(this.s[this.i])) this.i++
    let name = this.s.slice(start, this.i)

    // `new Date(...)` / `new ObjectId(...)` — swallow the constructor keyword.
    if (name === 'new') {
      this.ws()
      const s2 = this.i
      while (this.i < this.s.length && this.isIdentPart(this.s[this.i])) this.i++
      name = this.s.slice(s2, this.i)
    }

    switch (name) {
      case 'true': return true
      case 'false': return false
      case 'null': return null
      case 'undefined': return null
    }

    this.ws()
    if (this.s[this.i] !== '(') {
      throw this.error(`Unexpected identifier '${name}'`)
    }
    const args = this.args()
    return this.construct(name, args)
  }

  private args(): ArgValue[] {
    this.expect('(')
    const args: ArgValue[] = []
    this.ws()
    if (this.s[this.i] === ')') { this.i++; return args }
    for (;;) {
      const v = this.value()
      if (v !== null && typeof v === 'object') {
        throw this.error('Constructor arguments must be primitives')
      }
      args.push(v as ArgValue)
      this.ws()
      const ch = this.s[this.i]
      if (ch === ',') { this.i++; continue }
      if (ch === ')') { this.i++; return args }
      throw this.error("Expected ',' or ')'")
    }
  }

  private construct(name: string, args: ArgValue[]): unknown {
    const str = (v: ArgValue | undefined): string => (v === undefined || v === null ? '' : String(v))
    switch (name) {
      case 'ObjectId':
      case 'ObjectID':
        return { $oid: str(args[0]) }
      case 'ISODate':
      case 'Date':
        // Date() with no args → "now" is intentionally unsupported; a document
        // edit should be deterministic, so require an explicit timestamp.
        if (args.length === 0) throw this.error('Date() requires an argument')
        return { $date: str(args[0]) }
      case 'NumberLong':
        return { $numberLong: str(args[0]) }
      case 'NumberInt':
        return Number(args[0])
      case 'NumberDecimal':
        return { $numberDecimal: str(args[0]) }
      case 'UUID':
        return { $uuid: str(args[0]) }
      case 'BinData':
        // BinData(subType, base64)
        return { $binary: str(args[1]), $type: Number(args[0]).toString(16) }
      case 'Timestamp':
        return { $timestamp: { t: Number(args[0]) || 0, i: Number(args[1]) || 0 } }
      default:
        throw this.error(`Unsupported constructor '${name}()'`)
    }
  }

  private expect(ch: string): void {
    if (this.s[this.i] !== ch) throw this.error(`Expected '${ch}'`)
    this.i++
  }

  private isIdentStart(c: string): boolean {
    return c !== undefined && (/[A-Za-z_$]/.test(c))
  }

  private isIdentPart(c: string): boolean {
    return c !== undefined && (/[A-Za-z0-9_$]/.test(c))
  }
}

/**
 * Parse shell-flavoured document text into a JS value with Extended-JSON type
 * markers. Throws ShellParseError with a line/column on malformed input.
 */
export function parseShellDocument(text: string): unknown {
  return new Parser(text).parse()
}
