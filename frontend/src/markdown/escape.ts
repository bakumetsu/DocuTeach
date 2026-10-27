const WS_RE = /\s/

export function escapeInline(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]

    if (c === '\\') {
      out += '\\\\'
      i++
    } else if (c === '`') {
      out += '\\`'
      i++
    } else if (c === '*') {
      out += '\\*'
      i++
    } else if (c === '[') {
      out += '\\['
      i++
    } else if (c === ']') {
      out += '\\]'
      i++
    } else if (c === '_') {
      const start = i
      while (i < text.length && text[i] === '_') i++
      const end = i
      const leftOk = start === 0 || WS_RE.test(text[start - 1])
      const rightOk = end === text.length || WS_RE.test(text[end])
      if (leftOk && rightOk) {
        out += text.slice(start, end)
      } else {
        for (let j = start; j < end; j++) out += '\\_'
      }
    } else if (c === '{') {
      if (i + 1 < text.length && text[i + 1] === '{') {
        out += '\\{'
      } else {
        out += '{'
      }
      i++
    } else if (c === '=') {
      const start = i
      while (i < text.length && text[i] === '=') i++
      const end = i
      if (end - start >= 2) {
        for (let j = start; j < end; j++) out += '\\='
      } else {
        out += '='
      }
    } else if (c === '<') {
      if (i + 1 < text.length && /[a-zA-Z/!?]/.test(text[i + 1])) {
        out += '\\<'
      } else {
        out += '<'
      }
      i++
    } else if (c === '&') {
      const rest = text.slice(i + 1)
      if (/^[a-zA-Z]+;/.test(rest) || /^#[0-9]+;/.test(rest)) {
        out += '\\&'
      } else {
        out += '&'
      }
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

export function escapeLineStart(line: string, wholeLine: boolean): string {
  // Rule 1: starts with #, >, -, +, or :::
  if (/^[#>\-+]/.test(line) || line.startsWith(':::')) {
    return '\\' + line
  }

  // Rule 2: starts with digits followed by . or )
  const m = line.match(/^(\d+)([.)])/)
  if (m) {
    const dotIdx = m[1].length
    return line.slice(0, dotIdx) + '\\' + line.slice(dotIdx)
  }

  // Rule 3 (wholeLine only): line consists only of - (3+) or _ (3+) with optional spaces
  if (wholeLine) {
    const dashCount = (line.match(/-/g) ?? []).length
    const underscoreCount = (line.match(/_/g) ?? []).length
    const nonDashNonSpace = line.replace(/[-\s]/g, '')
    const nonUnderscoreNonSpace = line.replace(/[_\s]/g, '')

    if (dashCount >= 3 && nonDashNonSpace === '' && line.includes('-')) {
      const firstDash = line.indexOf('-')
      return line.slice(0, firstDash) + '\\' + line.slice(firstDash)
    }
    if (underscoreCount >= 3 && nonUnderscoreNonSpace === '' && line.includes('_')) {
      const firstUnd = line.indexOf('_')
      return line.slice(0, firstUnd) + '\\' + line.slice(firstUnd)
    }
  }

  return line
}

export function escapeAnswer(s: string): string {
  return s.replace(/([\\|}])/g, '\\$1')
}

export function unescapeAnswer(s: string): string {
  return s.replace(/\\([\\|}])/g, '$1')
}

export function escapeTag(s: string): string {
  return s.replace(/([\\"])/g, '\\$1')
}

export function unescapeTag(s: string): string {
  return s.replace(/\\([\\"])/g, '$1')
}

export function escapeCellPipes(md: string): string {
  let out = ''
  let i = 0
  while (i < md.length) {
    // Check for {{ blank start
    if (md[i] === '{' && i + 1 < md.length && md[i + 1] === '{') {
      // Find the closing }} that is not preceded by an odd number of backslashes
      out += '{{'
      i += 2
      let j = i
      let found = false
      while (j < md.length) {
        if (md[j] === '}' && j + 1 < md.length && md[j + 1] === '}') {
          // Count preceding backslashes
          let bs = 0
          let k = j - 1
          while (k >= 0 && md[k] === '\\') {
            bs++
            k--
          }
          if (bs % 2 === 0) {
            // Even number of backslashes (including zero) → unescaped }}
            out += md.slice(i, j + 2)
            i = j + 2
            found = true
            break
          }
        }
        j++
      }
      if (!found) {
        // No closing }} found; copy rest as-is
        out += md.slice(i)
        i = md.length
      }
    } else if (md[i] === '|') {
      out += '\\|'
      i++
    } else {
      out += md[i]
      i++
    }
  }
  return out
}
