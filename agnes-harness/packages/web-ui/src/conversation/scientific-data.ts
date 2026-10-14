export interface DataTable {
  columns: string[]
  rows: string[][]
  truncated: boolean
}

/** Bounded CSV/TSV parser preserving quoted delimiters, escaped quotes and multiline fields. */
export function parseDataTable(source: string, filename: string): DataTable {
  if (source.length > 2 * 1024 * 1024) throw new Error('数据预览最多读取 2 MiB，请下载完整文件。')
  if (/\.json$/i.test(filename)) {
    const parsed: unknown = JSON.parse(source)
    const records = Array.isArray(parsed) ? parsed : [parsed]
    if (!records.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r)))
      throw new Error('JSON 表格需要对象或对象数组。')
    const rows = records.slice(0, 201) as Record<string, unknown>[]
    const columns = [...new Set(rows.flatMap(Object.keys))].slice(0, 50)
    return {
      columns,
      rows: rows
        .slice(0, 200)
        .map((r) =>
          columns.map((c) =>
            r[c] === undefined ? '' : typeof r[c] === 'string' ? r[c] : JSON.stringify(r[c]),
          ),
        ),
      truncated: records.length > 200 || rows.some((r) => Object.keys(r).length > 50),
    }
  }
  const delimiter = /\.tsv$/i.test(filename) ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false
  let truncated = false
  const add = (): void => {
    if (row.length < 50) row.push(field)
    else truncated = true
    field = ''
    closed = false
  }
  const end = (): boolean => {
    add()
    rows.push(row)
    row = []
    return rows.length > 201
  }
  const input = source.replace(/^\uFEFF/, '')
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
          closed = true
        }
      } else field += c
    } else if (c === '"') {
      if (field || closed) throw new Error('CSV 引号格式不正确。')
      quoted = true
    } else if (c === delimiter) add()
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++
      if (end()) {
        truncated = true
        break
      }
    } else {
      if (closed && c?.trim()) throw new Error('CSV 引号后存在无效字符。')
      if (!closed) field += c
    }
  }
  if (quoted) throw new Error('CSV 引号未闭合。')
  if (field || row.length || closed) end()
  return { columns: rows[0] ?? [], rows: rows.slice(1, 201), truncated }
}

export interface Atom {
  element: string
  x: number
  y: number
  z: number
}
export interface Molecule {
  atoms: Atom[]
  bonds: [number, number, number][]
}
const numeric = (value: string | undefined): number => {
  if (!value?.trim()) throw new Error('分子坐标缺失。')
  const n = Number(value)
  if (!Number.isFinite(n) || Math.abs(n) > 100000) throw new Error('分子坐标无效。')
  return n
}
const element = (value: string): string => {
  if (!/^[A-Za-z]{1,2}$/.test(value)) throw new Error('元素符号无效。')
  return value[0]?.toUpperCase() + value.slice(1).toLowerCase()
}
export function parseMolecule(source: string, filename: string): Molecule {
  if (source.length > 2 * 1024 * 1024) throw new Error('结构预览最多读取 2 MiB。')
  const lines = source.split(/\r?\n/)
  const atoms: Atom[] = [],
    bonds: Molecule['bonds'] = []
  if (/\.xyz$/i.test(filename)) {
    const count = Number(lines[0])
    if (!Number.isSafeInteger(count) || count < 1 || count > 5000)
      throw new Error('XYZ 原子数量应为 1–5000。')
    for (const line of lines.slice(2, count + 2)) {
      const [symbol, x, y, z] = line.trim().split(/\s+/)
      atoms.push({ element: element(symbol ?? ''), x: numeric(x), y: numeric(y), z: numeric(z) })
    }
    if (atoms.length !== count) throw new Error('XYZ 原子数量与坐标不符。')
  } else if (/\.(mol|sdf)$/i.test(filename)) {
    const counts = lines[3] ?? ''
    if (/V3000/.test(counts)) throw new Error('当前结构预览支持 MOL/SDF V2000，请下载 V3000 源文件。')
    const count = Number(counts.slice(0, 3)),
      bondCount = Number(counts.slice(3, 6))
    if (
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > 5000 ||
      !Number.isSafeInteger(bondCount) ||
      bondCount < 0 ||
      bondCount > 10000
    )
      throw new Error('MOL/SDF 数量字段无效。')
    for (const line of lines.slice(4, 4 + count))
      atoms.push({
        element: element(line.slice(31, 34).trim()),
        x: numeric(line.slice(0, 10)),
        y: numeric(line.slice(10, 20)),
        z: numeric(line.slice(20, 30)),
      })
    if (atoms.length !== count) throw new Error('结构文件不完整。')
    for (const line of lines.slice(4 + count, 4 + count + bondCount)) {
      const a = Number(line.slice(0, 3)) - 1,
        b = Number(line.slice(3, 6)) - 1,
        order = Number(line.slice(6, 9))
      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a < 0 ||
        b < 0 ||
        a >= count ||
        b >= count ||
        ![1, 2, 3, 4].includes(order)
      )
        throw new Error('分子键索引无效。')
      bonds.push([a, b, order])
    }
    if (bonds.length !== bondCount) throw new Error('分子键信息不完整。')
  } else if (/\.pdb$/i.test(filename)) {
    const ids = new Map<number, number>()
    let inModel = false
    for (const line of lines) {
      if (line.startsWith('MODEL ')) {
        if (inModel) break
        inModel = true
      }
      if (line.startsWith('ENDMDL')) break
      if (!/^(ATOM {2}|HETATM)/.test(line) || ![' ', 'A', ''].includes(line.slice(16, 17))) continue
      if (atoms.length >= 5000) throw new Error('结构预览最多显示 5000 个原子，请缩小结构。')
      const symbol = line.slice(76, 78).trim() || line.slice(12, 16).trim().replace(/^\d+/, '')[0] || ''
      ids.set(Number(line.slice(6, 11)), atoms.length)
      atoms.push({
        element: element(symbol),
        x: numeric(line.slice(30, 38)),
        y: numeric(line.slice(38, 46)),
        z: numeric(line.slice(46, 54)),
      })
    }
    const seen = new Set<string>()
    for (const line of lines.filter((l) => l.startsWith('CONECT'))) {
      const serials =
        line
          .slice(6)
          .match(/.{1,5}/g)
          ?.map(Number) ?? []
      const a = ids.get(serials[0] ?? -1)
      for (const id of serials.slice(1)) {
        const b = ids.get(id)
        if (a === undefined || b === undefined || a === b) continue
        const key = [Math.min(a, b), Math.max(a, b)].join(':')
        if (!seen.has(key)) {
          bonds.push([a, b, 1])
          seen.add(key)
        }
      }
    }
  } else throw new Error('支持 PDB、MOL、SDF 和 XYZ 结构文件。')
  if (!atoms.length) throw new Error('没有找到可显示的原子。')
  return { atoms, bonds }
}

export function scientificFileKind(
  filename: string,
  mime: string,
): 'data' | 'molecule' | 'pdf' | 'image' | 'text' {
  if (/\.(csv|tsv|json)$/i.test(filename)) return 'data'
  if (/\.(pdb|mol|sdf|xyz)$/i.test(filename)) return 'molecule'
  if (mime === 'application/pdf' || /\.pdf$/i.test(filename)) return 'pdf'
  if (['image/png', 'image/jpeg'].includes(mime)) return 'image'
  return 'text'
}
