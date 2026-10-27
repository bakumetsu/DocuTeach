export function scriptFor(
  skill: string | undefined,
  userText: string,
  selection?: string,
): { kind?: 'teacherNote' | 'blanks' | 'text'; markdown: string } {
  if (skill === '/ccq') {
    return {
      kind: 'teacherNote',
      markdown:
        '::: teacher {tag="CCQ"}\n' +
        'Is the action finished? (Not necessarily.)\n' +
        '\n' +
        '- Does she still live in Hanoi? (Yes.)\n' +
        '- Did she move away? (No.)\n' +
        '- Gợi ý: hỏi học sinh bằng tiếng Việt nếu cần.\n' +
        ':::',
    }
  }
  if (skill === '/drills') {
    return {
      kind: 'blanks',
      markdown:
        "1. She {{has lived | 's lived}} in Hanoi for six years.\n" +
        '2. They {{have worked}} here since 2020.\n' +
        "3. I {{haven't seen}} him today.\n" +
        '4. We {{have known}} each other for ages.\n' +
        '5. Nó {{đã sống}} (live) ở đây rất lâu.',
    }
  }
  if (skill === '/pitfalls') {
    return {
      kind: 'teacherNote',
      markdown:
        '::: teacher {tag="Pitfalls"}\n' +
        "- Do not confuse 'since' (point in time) with 'for' (duration).\n" +
        '- Do not use the past simple where the present perfect is needed for a connection to the present.\n' +
        ':::',
    }
  }
  let md = `Here is a short answer to "${userText.slice(0, 60)}".`
  if (selection && selection.length > 0) {
    md += ` You selected: "${selection.slice(0, 80)}".`
  }
  md += ` (This is a scripted reply from the mock assistant.)`
  return { kind: 'text', markdown: md }
}

export function tokenize(markdown: string): string[] {
  const tokens: string[] = []
  const re = /\S+|\s+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    tokens.push(m[0])
  }
  return tokens
}
