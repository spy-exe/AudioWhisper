"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { MODEL_OPTIONS } from "@/lib/constants";
import { api } from "@/lib/api";
import type { GpuDiagnostics } from "@/lib/types";
import { useSettings } from "@/contexts/SettingsContext";

import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { Toggle } from "@/components/ui/Toggle";
import { IntelligenceSettings } from "@/components/workspace/IntelligenceSettings";

const COMPUTE_TYPES = ["int8", "int8_float16", "float16", "float32"];
const DEVICES = ["cuda", "cpu"];

const PANEL_VARIANTS = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.3 },
  }),
};

export default function SettingsPage() {
  const { settings, loading, update } = useSettings();
  const [gpu, setGpu] = useState<GpuDiagnostics | null>(null);

  useEffect(() => {
    api
      .healthGpu()
      .then(setGpu)
      .catch(() => setGpu(null));
  }, []);

  if (loading || !settings) {
    return (
      <p className="p-8 text-sm text-text-muted">Carregando configurações…</p>
    );
  }

  return (
    <div className="settings-page">
      <div className="page-heading">
        <h1>Configurações</h1>
        <p className="mt-3 text-text-secondary">
          Ajuste os motores, o processamento e a experiência do seu Studio.
        </p>
      </div>
      <div className="settings-cards">
        <IntelligenceSettings />

        <motion.div
          custom={0}
          variants={PANEL_VARIANTS}
          initial="hidden"
          animate="visible"
        >
          <Panel raised className="flex flex-col gap-4 p-5">
            <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
              Diagnóstico de GPU
            </h2>
            {gpu ? (
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-text-muted">Disponível</dt>
                <dd>
                  <Badge tone={gpu.gpu_available ? "success" : "warning"}>
                    {gpu.gpu_available ? "sim" : "não"}
                  </Badge>
                </dd>
                <dt className="text-text-muted">GPU</dt>
                <dd className="text-text-primary">
                  {gpu.gpu_name ?? "Não disponível"}
                </dd>
                <dt className="text-text-muted">VRAM livre</dt>
                <dd className="text-text-primary">
                  {gpu.free_memory_mb != null
                    ? `${Math.round(gpu.free_memory_mb)} MiB`
                    : "Não disponível"}
                </dd>
                <dt className="text-text-muted">Driver</dt>
                <dd className="text-text-primary">
                  {gpu.driver_version ?? "Não disponível"}
                </dd>
                <dt className="text-text-muted">CTranslate2</dt>
                <dd className="text-text-primary">
                  {gpu.ctranslate2_version ?? "Não disponível"}
                </dd>
                <dt className="text-text-muted">Modelo carregado</dt>
                <dd className="text-text-primary">
                  {gpu.loaded_model ?? "nenhum ainda"}
                </dd>
                {gpu.error && (
                  <>
                    <dt className="text-text-muted">Aviso</dt>
                    <dd className="text-warning">{gpu.error}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="text-sm text-text-muted">Sem resposta do worker.</p>
            )}
          </Panel>
        </motion.div>

        <motion.div
          custom={1}
          variants={PANEL_VARIANTS}
          initial="hidden"
          animate="visible"
        >
          <Panel raised className="flex flex-col gap-4 p-5">
            <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
              Transcrição
            </h2>

            <Field label="Modelo padrão">
              <select
                value={settings.default_model}
                onChange={(e) => update({ default_model: e.target.value })}
                className="select-field"
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Dispositivo">
              <select
                value={settings.transcription_device}
                onChange={(e) =>
                  update({ transcription_device: e.target.value })
                }
                className="select-field"
              >
                {DEVICES.map((d) => (
                  <option key={d} value={d}>
                    {d.toUpperCase()}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Compute type">
              <select
                value={settings.transcription_compute_type}
                onChange={(e) =>
                  update({ transcription_compute_type: e.target.value })
                }
                className="select-field"
              >
                {COMPUTE_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Beam size">
              <input
                type="number"
                min={1}
                max={10}
                value={settings.default_beam_size}
                onChange={(e) =>
                  update({ default_beam_size: Number(e.target.value) })
                }
                className="select-field w-20"
              />
            </Field>

            <Toggle
              label="VAD (detecção de atividade de voz)"
              checked={settings.default_vad_enabled}
              onChange={(v) => update({ default_vad_enabled: v })}
            />
            <Toggle
              label="Timestamps por palavra"
              checked={settings.default_word_timestamps}
              onChange={(v) => update({ default_word_timestamps: v })}
            />
            <Toggle
              label="Traduzir para inglês"
              checked={settings.default_translate_to_english}
              onChange={(v) => update({ default_translate_to_english: v })}
            />
          </Panel>
        </motion.div>

        <motion.div
          custom={2}
          variants={PANEL_VARIANTS}
          initial="hidden"
          animate="visible"
        >
          <Panel raised className="flex flex-col gap-4 p-5">
            <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">
              Interface
            </h2>
            <Toggle
              label="Efeitos visuais (waveform reativa e cena ambiente)"
              checked={settings.visual_effects_enabled}
              onChange={(v) => update({ visual_effects_enabled: v })}
            />
          </Panel>
        </motion.div>
      </div>
      <style>{`
        .select-field {
          max-width: 100%;
          min-width: 0;
          background: var(--color-surface-interactive);
          border: 1px solid var(--color-border);
          border-radius: 0.625rem;
          padding: 0.625rem 0.75rem;
          min-height: 44px;
          font-size: 1rem;
          color: var(--color-text-primary);
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary sm:flex-nowrap">
      {label}
      {children}
    </label>
  );
}
