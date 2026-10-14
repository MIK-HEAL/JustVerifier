import { useMemo, useState } from 'react'
import { DocumentPreview } from './document-preview.js'
import { PdfPagePreview } from './pdf-page-preview.js'
import { type Molecule, parseDataTable, parseMolecule, scientificFileKind } from './scientific-data.js'

export function ScientificFilePreview({
  filename,
  mime,
  content = '',
  resourceUrl,
  bytes,
}: {
  filename: string
  mime: string
  content?: string
  resourceUrl?: string
  bytes?: Uint8Array
}) {
  const kind = scientificFileKind(filename, mime)
  const parsed = useMemo(() => {
    try {
      return {
        table: kind === 'data' ? parseDataTable(content, filename) : undefined,
        molecule: kind === 'molecule' ? parseMolecule(content, filename) : undefined,
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : '文件无法预览。' }
    }
  }, [kind, content, filename])
  return (
    <section className="scientific-preview" data-scientific-preview={kind} aria-label={filename}>
      {parsed.error ? (
        <p role="alert">{parsed.error}</p>
      ) : parsed.table ? (
        <>
          <p>
            {parsed.table.rows.length} 行 · {parsed.table.columns.length} 列
            {parsed.table.truncated ? '（预览已截断，下载查看完整文件）' : ''}
          </p>
          <div className="scientific-table-scroll">
            <table>
              <thead>
                <tr>
                  {parsed.table.columns.map((c, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: A read-only table retains source column positions, including duplicate headers.
                    <th key={`${i}:${c}`} scope="col">
                      {c || `列 ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.table.rows.map((r, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Source row positions identify read-only cells, including duplicate rows.
                  <tr key={`${i}:${r.join('|')}`}>
                    {parsed.table?.columns.map((_, j) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: Cells are read-only and identified by their source column position.
                      <td key={j}>{r[j] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : kind === 'pdf' ? (
        <PdfPagePreview {...(bytes ? { bytes } : {})} title={filename} />
      ) : parsed.molecule ? (
        <MoleculePreview key={filename} molecule={parsed.molecule} />
      ) : (
        <DocumentPreview
          kind={kind === 'data' || kind === 'molecule' ? 'text' : kind}
          title={filename}
          content={content}
          {...(resourceUrl ? { resourceUrl } : {})}
        />
      )}
    </section>
  )
}
const colors: Record<string, string> = {
  C: '#666666',
  H: '#dddddd',
  O: '#e34b4b',
  N: '#507dd8',
  S: '#d6ad28',
  P: '#d88235',
  F: '#65ad6a',
  Cl: '#65ad6a',
}
function MoleculePreview({ molecule }: { molecule: Molecule }) {
  const [angle, setAngle] = useState(25)
  const [tilt, setTilt] = useState(15)
  const [zoom, setZoom] = useState(1)
  const points = useMemo(() => {
    const { atoms } = molecule
    const center = ['x', 'y', 'z'].map(
      (axis) => atoms.reduce((s, a) => s + a[axis as 'x' | 'y' | 'z'], 0) / atoms.length,
    )
    const rad = (angle * Math.PI) / 180,
      t = (tilt * Math.PI) / 180
    const rotated = atoms.map((a) => {
      const x = a.x - (center[0] ?? 0),
        y = a.y - (center[1] ?? 0),
        z = a.z - (center[2] ?? 0)
      const rx = x * Math.cos(rad) + z * Math.sin(rad),
        rz = -x * Math.sin(rad) + z * Math.cos(rad)
      return {
        x: rx,
        y: y * Math.cos(t) - rz * Math.sin(t),
        z: y * Math.sin(t) + rz * Math.cos(t),
        element: a.element,
      }
    })
    const extent = Math.max(1, ...rotated.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))))
    return rotated.map((p) => ({
      ...p,
      x: 200 + (p.x / extent) * 160 * zoom,
      y: 160 - (p.y / extent) * 120 * zoom,
    }))
  }, [molecule, angle, tilt, zoom])
  return (
    <>
      <p>
        {molecule.atoms.length} 个原子 · {molecule.bonds.length} 个显式键 · 首个结构／模型
      </p>
      <svg viewBox="0 0 400 320" role="img" aria-label="分子结构三维投影">
        {molecule.bonds.map(([a, b, order]) => (
          <line
            key={`${a}:${b}`}
            x1={points[a]?.x}
            y1={points[a]?.y}
            x2={points[b]?.x}
            y2={points[b]?.y}
            stroke="currentColor"
            strokeWidth={order === 4 ? 2 : order * 1.5}
          />
        ))}
        {points
          .map((p, i) => ({ ...p, i }))
          .sort((a, b) => a.z - b.z)
          .map((p) => (
            <circle
              key={p.i}
              cx={p.x}
              cy={p.y}
              r={molecule.atoms.length > 500 ? 2 : 5}
              fill={colors[p.element] ?? '#a07bc0'}
              stroke="currentColor"
              strokeWidth="0.5"
            >
              <title>{`${p.i + 1} · ${p.element}`}</title>
            </circle>
          ))}
      </svg>
      <label>
        旋转
        <input
          type="range"
          min="-180"
          max="180"
          value={angle}
          onChange={(e) => setAngle(Number(e.target.value))}
        />
      </label>
      <label>
        俯仰
        <input
          type="range"
          min="-90"
          max="90"
          value={tilt}
          onChange={(e) => setTilt(Number(e.target.value))}
        />
      </label>
      <label>
        缩放
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          setAngle(25)
          setTilt(15)
          setZoom(1)
        }}
      >
        重置视角
      </button>
      {!molecule.bonds.length && <p>文件未提供显式键信息，当前显示原子坐标。</p>}
    </>
  )
}
