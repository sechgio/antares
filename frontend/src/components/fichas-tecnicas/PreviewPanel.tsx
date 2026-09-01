/**
 * Preview A4 — layout espejo de sech-gio/frontend/src/features/fichas-tecnicas/PreviewPanel.tsx
 * Logos llegan como data-URL (string) en Antares (no File).
 */
import { useMemo } from 'react';
import { normalizeFichaForPreview, type FichaTecnica } from './types';

interface Props {
  ficha: FichaTecnica | null;
  logoLeft: string | null;
}

export default function PreviewPanel({ ficha, logoLeft }: Props) {
  const data = useMemo(() => normalizeFichaForPreview(ficha), [ficha]);

  return (
    <div
      className="tr-preview-wrap ft-preview-scroll h-full min-h-0 overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3"
      data-testid="ficha-preview-scroll"
    >
      <div
        id="ficha-tecnica-preview"
        data-testid="ficha-preview-paper"
        data-template={ficha ? 'false' : 'true'}
        className="ficha-preview-container mx-auto shadow-lg"
        style={{
          width: '210mm',
          height: '297mm',
          minHeight: '297mm',
          maxHeight: '297mm',
          padding: '4px',
          backgroundColor: '#ffffff',
          fontFamily: "'Segoe UI', Calibri, Arial, sans-serif",
          fontSize: '7.5pt',
          lineHeight: '1.15',
          color: '#333333',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            border: '2px solid #333',
            padding: '12px',
            height: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Header: título y número en la misma línea; O.S.N° debajo del número */}
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '10px', gap: '4px' }}>
            {/* Logo Izquierdo */}
            <div
              style={{
                background: '#ffffff',
                padding: '5px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                minWidth: '200px',
                minHeight: '40px',
                flexShrink: 0,
              }}
            >
              {logoLeft ? (
                <img
                  src={logoLeft}
                  alt="Logo"
                  style={{ maxWidth: '180px', maxHeight: '40px', objectFit: 'contain' }}
                />
              ) : null}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Misma línea: título + número */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <div
                  style={{
                    flex: 1,
                    fontSize: '16px',
                    fontWeight: 'bold',
                    color: '#333',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    lineHeight: '1.2',
                  }}
                >
                  FICHA TÉCNICA DE EVALUACIÓN DE ACTIVIDADES
                </div>
                <span
                  style={{
                    color: '#c41e3a',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    lineHeight: '1.2',
                    letterSpacing: '0.5px',
                    flexShrink: 0,
                    textAlign: 'right',
                    minWidth: '52px',
                  }}
                >
                  {data.os_numero ? data.os_numero.replace(/^OS-/, '').replace(/-/g, '') : '00000'}
                </span>
              </div>
              {/* O.S.N° + rectángulo alineados a la derecha, debajo del número */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '6px',
                  marginTop: '3px',
                }}
              >
                <span style={{ fontSize: '9px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>O.S.N°</span>
                <div
                  style={{
                    border: '1px solid #333',
                    width: '110px',
                    height: '20px',
                    background: '#ffffff',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Client Info */}
          <div style={{ display: 'flex', gap: '15px', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
              <label style={{ fontWeight: 'bold', fontSize: '9px', whiteSpace: 'nowrap' }}>Cliente :</label>
              <div style={{ borderBottom: '1px solid #333', flex: 1, padding: '2px 4px', fontSize: '9px' }}>
                {data.cliente}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 0.5 }}>
              <label style={{ fontWeight: 'bold', fontSize: '9px', whiteSpace: 'nowrap' }}>Fecha :</label>
              <div style={{ borderBottom: '1px solid #333', flex: 1, padding: '2px 4px', fontSize: '9px' }}>
                {data.fecha ? data.fecha.split(' ')[0].split('-').reverse().join('-') : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '15px', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
              <label style={{ fontWeight: 'bold', fontSize: '9px', whiteSpace: 'nowrap' }}>Dirección :</label>
              <div style={{ borderBottom: '1px solid #333', flex: 1, padding: '2px 4px', fontSize: '9px' }}>
                {data.direccion}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 0.5 }}>
              <label style={{ fontWeight: 'bold', fontSize: '9px', whiteSpace: 'nowrap' }}>Distrito :</label>
              <div style={{ borderBottom: '1px solid #333', flex: 1, padding: '2px 4px', fontSize: '9px' }}>
                {data.distrito}
              </div>
            </div>
          </div>

          {/* Service and Diagnostic */}
          <div style={{ border: '2px solid #333', marginBottom: '8px' }}>
            <div style={{ display: 'flex' }}>
              <div style={{ flex: 1, borderRight: '2px solid #333' }}>
                <div
                  style={{
                    background: '#e0e0e0',
                    padding: '4px',
                    textAlign: 'center',
                    fontWeight: 'bold',
                    fontSize: '10px',
                    borderBottom: '2px solid #333',
                  }}
                >
                  SERVICIO A EFECTUAR
                </div>
                <div style={{ padding: '4px' }}>
                  {(
                    [
                      { key: 'desinfeccion', label: '1. DESINFECCIÓN' },
                      { key: 'limpieza_ambientes', label: '2. LIMPIEZA DE AMBIENTES' },
                      { key: 'limpieza_pozos_septicos', label: '3. LIMPIEZA DE POZOS SÉPTICOS' },
                      {
                        key: 'limpieza_reservorios',
                        label: '4. LIMPIEZA Y DESINFECCIÓN DE RESERVORIOS DE AGUA',
                      },
                    ] as const
                  ).map(({ key, label }) => (
                    <div
                      key={key}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '4px',
                        fontSize: '9px',
                      }}
                    >
                      <span>{label}</span>
                      <span
                        style={{
                          width: '16px',
                          height: '11px',
                          border: '1px solid #333',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '8px',
                          background: data.servicio[key] ? '#00a0b0' : 'white',
                          color: data.servicio[key] ? 'white' : 'black',
                        }}
                      >
                        {data.servicio[key] ? 'X' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    background: '#e0e0e0',
                    padding: '4px',
                    textAlign: 'center',
                    fontWeight: 'bold',
                    fontSize: '10px',
                    borderBottom: '2px solid #333',
                  }}
                >
                  DIAGNÓSTICO DEL ÁREA A TRATAR
                </div>
                <div style={{ padding: '8px', minHeight: '70px', fontSize: '9px' }}>{data.diagnostico_area}</div>
              </div>
            </div>
          </div>

          {/* Sanitary Condition */}
          <div style={{ border: '2px solid #333', marginBottom: '8px' }}>
            <div
              style={{
                background: '#e0e0e0',
                padding: '4px',
                textAlign: 'center',
                fontWeight: 'bold',
                fontSize: '10px',
                borderBottom: '2px solid #333',
              }}
            >
              CONDICIÓN SANITARIA DE LA ZONA CIRCUNDANTE
            </div>
            <div style={{ padding: '4px', minHeight: '40px', fontSize: '9px' }}>{data.condicion_sanitaria}</div>
          </div>

          {/* Treatment Types */}
          <div style={{ border: '2px solid #333', marginBottom: '8px' }}>
            <div
              style={{
                background: '#e0e0e0',
                padding: '4px',
                textAlign: 'center',
                fontWeight: 'bold',
                fontSize: '10px',
                borderBottom: '2px solid #333',
              }}
            >
              TIPOS DE TRATAMIENTO
            </div>
            <div style={{ display: 'flex', padding: '4px 12px' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', paddingRight: '12px' }}>
                {(
                  [
                    { key: 'pulverizado', label: 'Pulverizado' },
                    { key: 'atomizado', label: 'Atomizado' },
                  ] as const
                ).map(({ key, label }) => (
                  <div
                    key={key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      fontSize: '9px',
                    }}
                  >
                    <span>{label}</span>
                    <span
                      style={{
                        width: '16px',
                        height: '11px',
                        border: '1px solid #333',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '8px',
                        marginLeft: 'auto',
                        flexShrink: 0,
                        background: data.tratamiento[key] ? '#00a0b0' : 'white',
                        color: data.tratamiento[key] ? 'white' : 'black',
                      }}
                    >
                      {data.tratamiento[key] ? 'X' : ''}
                    </span>
                  </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', fontSize: '9px' }}>
                  <span>Otros: {data.tratamiento.otros}</span>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', paddingRight: '4px', paddingLeft: '16px' }}>
                {(
                  [
                    { key: 'thermonebulizado', label: 'Thermonebulizado' },
                    { key: 'nebulizado_ulv', label: 'Nebulizado ULV' },
                  ] as const
                ).map(({ key, label }) => (
                  <div
                    key={key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      fontSize: '9px',
                    }}
                  >
                    <span>{label}</span>
                    <span
                      style={{
                        width: '16px',
                        height: '11px',
                        border: '1px solid #333',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '8px',
                        marginLeft: 'auto',
                        flexShrink: 0,
                        background: data.tratamiento[key] ? '#00a0b0' : 'white',
                        color: data.tratamiento[key] ? 'white' : 'black',
                      }}
                    >
                      {data.tratamiento[key] ? 'X' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Products Table */}
          <div style={{ border: '2px solid #333', marginBottom: '8px' }}>
            <div
              style={{
                background: '#e0e0e0',
                padding: '4px',
                textAlign: 'center',
                fontWeight: 'bold',
                fontSize: '10px',
                borderBottom: '2px solid #333',
              }}
            >
              PRODUCTOS QUÍMICOS Y/O BIOLÓGICOS UTILIZADOS
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ border: '1px solid #333', padding: '4px', fontSize: '8px', background: '#f5f5f5' }}>
                    PRODUCTO
                  </th>
                  <th style={{ border: '1px solid #333', padding: '4px', fontSize: '8px', background: '#f5f5f5' }}>
                    COMPOSICIÓN
                  </th>
                  <th style={{ border: '1px solid #333', padding: '4px', fontSize: '8px', background: '#f5f5f5' }}>
                    LOTE
                  </th>
                  <th style={{ border: '1px solid #333', padding: '4px', fontSize: '7px', background: '#f5f5f5' }}>
                    FECHA DE
                    <br />
                    VENCIMIENTO
                  </th>
                  <th style={{ border: '1px solid #333', padding: '4px', fontSize: '8px', background: '#f5f5f5' }}>
                    UNIDAD
                  </th>
                  <th style={{ border: '1px solid #333', padding: '4px', fontSize: '8px', background: '#f5f5f5' }}>
                    CONCENTRACIÓN
                  </th>
                  <th style={{ border: '1px solid #333', padding: '4px', fontSize: '8px', background: '#f5f5f5' }}>
                    CANTIDAD
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.productos.map((prod, idx) => (
                  <tr key={idx}>
                    <td style={{ border: '1px solid #333', padding: '4px', fontSize: '8px', textAlign: 'center' }}>
                      {prod.producto}
                    </td>
                    <td style={{ border: '1px solid #333', padding: '4px', fontSize: '8px', textAlign: 'center' }}>
                      {prod.composicion}
                    </td>
                    <td style={{ border: '1px solid #333', padding: '4px', fontSize: '8px', textAlign: 'center' }}>
                      {prod.lote}
                    </td>
                    <td style={{ border: '1px solid #333', padding: '4px', fontSize: '8px', textAlign: 'center' }}>
                      {prod.fecha_vencimiento}
                    </td>
                    <td style={{ border: '1px solid #333', padding: '4px', fontSize: '8px', textAlign: 'center' }}>
                      {prod.unidad}
                    </td>
                    <td style={{ border: '1px solid #333', padding: '4px', fontSize: '8px', textAlign: 'center' }}>
                      {prod.concentracion}
                    </td>
                    <td style={{ border: '1px solid #333', padding: '4px', fontSize: '8px', textAlign: 'center' }}>
                      {prod.cantidad ? parseFloat(prod.cantidad).toFixed(4) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Corrective Actions */}
          <div style={{ border: '2px solid #333', marginBottom: '8px' }}>
            <div
              style={{
                background: '#e0e0e0',
                padding: '4px',
                textAlign: 'center',
                fontWeight: 'bold',
                fontSize: '10px',
                borderBottom: '2px solid #333',
              }}
            >
              ACCIONES CORRECTIVAS
            </div>
            <div style={{ padding: '4px', minHeight: '50px', fontSize: '9px' }}>{data.acciones_correctivas}</div>
          </div>

          {/* Treated Areas */}
          <div style={{ border: '2px solid #333', marginBottom: '8px' }}>
            <div
              style={{
                background: '#e0e0e0',
                padding: '4px',
                textAlign: 'center',
                fontWeight: 'bold',
                fontSize: '10px',
                borderBottom: '2px solid #333',
              }}
            >
              ÁREAS TRATADAS
            </div>
            <div style={{ padding: '4px', minHeight: '50px', fontSize: '9px' }}>{data.areas_tratadas}</div>
          </div>

          {/* Technical Staff */}
          <div style={{ border: '2px solid #333', marginBottom: '8px' }}>
            <div
              style={{
                background: '#e0e0e0',
                padding: '4px',
                textAlign: 'center',
                fontWeight: 'bold',
                fontSize: '10px',
                borderBottom: '2px solid #333',
              }}
            >
              PERSONAL TÉCNICO
            </div>
            <div style={{ display: 'flex', borderBottom: '2px solid #333' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1.5px solid #333' }}>
                {data.personal_tecnico.slice(0, 3).map((persona, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '3px 6px',
                        fontSize: '8px',
                        minHeight: '18px',
                        borderBottom: idx < 2 ? '1px solid #ddd' : 'none',
                      }}
                    >
                      {persona}
                    </div>
                  ))}
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                {data.personal_tecnico.slice(3, 6).map((persona, idx) => (
                    <div
                      key={idx + 3}
                      style={{
                        padding: '3px 6px',
                        fontSize: '8px',
                        minHeight: '18px',
                        borderBottom: idx < 2 ? '1px solid #ddd' : 'none',
                      }}
                    >
                      {persona}
                    </div>
                  ))}
              </div>
            </div>
            <div style={{ display: 'flex', borderTop: '2px solid #333' }}>
              <div
                style={{
                  flex: 1,
                  padding: '4px',
                  borderRight: '1px solid #333',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <label style={{ fontWeight: 'bold', fontSize: '9px' }}>HORA INICIO :</label>
                <div style={{ borderBottom: '1px solid #333', flex: 1, fontSize: '9px' }}>{data.hora_inicio}</div>
              </div>
              <div
                style={{
                  flex: 1,
                  padding: '4px',
                  borderRight: '1px solid #333',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <label style={{ fontWeight: 'bold', fontSize: '9px' }}>HORA TÉRMINO :</label>
                <div style={{ borderBottom: '1px solid #333', flex: 1, fontSize: '9px' }}>{data.hora_termino}</div>
              </div>
              <div style={{ flex: 1, padding: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <label style={{ fontWeight: 'bold', fontSize: '9px' }}>N° CERTIFICADO :</label>
                <div style={{ borderBottom: '1px solid #333', flex: 1, fontSize: '9px' }}>
                  {data.numero_certificado}
                </div>
              </div>
            </div>
          </div>

          {/* Observations and Recommendations */}
          <div style={{ border: '2px solid #333', marginBottom: '8px' }}>
            <div style={{ display: 'flex' }}>
              <div style={{ flex: 1, padding: '4px', borderRight: '1px solid #333' }}>
                <div style={{ fontWeight: 'bold', textAlign: 'center', marginBottom: '4px', fontSize: '9px' }}>
                  OBSERVACIONES
                </div>
                {(['a', 'b', 'c'] as const).map((letter) => (
                  <div key={letter} style={{ display: 'flex', gap: '4px', marginBottom: '3px' }}>
                    <span style={{ fontSize: '9px' }}>{letter})</span>
                    <div style={{ flex: 1, borderBottom: '1px solid #333', fontSize: '9px' }}>
                      {data.obs_rec[`observacion_${letter}`]}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, padding: '4px' }}>
                <div style={{ fontWeight: 'bold', textAlign: 'center', marginBottom: '4px', fontSize: '9px' }}>
                  RECOMENDACIONES
                </div>
                {(['a', 'b', 'c'] as const).map((letter) => (
                  <div key={letter} style={{ display: 'flex', gap: '4px', marginBottom: '3px' }}>
                    <span style={{ fontSize: '9px' }}>{letter})</span>
                    <div style={{ flex: 1, borderBottom: '1px solid #333', fontSize: '9px' }}>
                      {data.obs_rec[`recomendacion_${letter}`]}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Satisfaction */}
          <div style={{ border: '2px solid #333', marginBottom: 0 }}>
            <div
              style={{
                background: '#e0e0e0',
                padding: '4px',
                textAlign: 'center',
                fontWeight: 'bold',
                fontSize: '10px',
                borderBottom: '2px solid #333',
              }}
            >
              EVALUACIÓN DE SATISFACCIÓN DEL CLIENTE
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-around', padding: '8px' }}>
              {(
                [
                  { value: 'muy_satisfecho', label: 'Muy Satisfecho', emoji: '😊' },
                  { value: 'satisfecho', label: 'Satisfecho', emoji: '🙂' },
                  { value: 'regular', label: 'Regular', emoji: '😐' },
                  { value: 'insatisfecho', label: 'Insatisfecho', emoji: '🙁' },
                ] as const
              ).map(({ value, label, emoji }) => (
                <div
                  key={value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '9px',
                    fontWeight: data.satisfaccion === value ? 'bold' : 'normal',
                    background: data.satisfaccion === value ? '#262626' : 'transparent',
                    color: data.satisfaccion === value ? '#ffffff' : '#333',
                    padding: '2px 6px',
                    borderRadius: '3px',
                  }}
                >
                  <span style={{ fontSize: '14px' }}>{emoji}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
          </div>

          {/* Firmas + footer al pie del marco A4 (igual que el PDF) */}
          <div style={{ flex: '0 0 auto', marginTop: 'auto' }}>
          {/* Signatures */}
          <div style={{ display: 'flex', justifyContent: 'space-around', margin: '28px 0 10px 0' }}>
            {['Responsable de Servicio', 'Cliente', 'Director Técnico'].map((label) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ width: '130px', borderTop: '1px solid #333', marginBottom: '4px' }} />
                <div style={{ fontSize: '8px' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Footer — idéntico a sech-gio / PDF */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '15px',
              paddingTop: '8px',
              fontSize: '8px',
              color: '#00a0b0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="#00a0a0"
                stroke="#00a0a0"
                strokeWidth="2"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" fill="white" />
              </svg>
              <span>Mz J1 lote 20. Urb. Los Precursores. Surco. Lima</span>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  marginBottom: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#00a0a0"
                  strokeWidth="2"
                >
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M22 6l-10 7L2 6" />
                </svg>
                <span>operaciones@hidroserviciosaa.com.pe</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#00a0a0"
                  strokeWidth="2"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                <span>+51 946 803 367</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#00a0a0"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span>www.hidroserviciosaa.com.pe/</span>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
