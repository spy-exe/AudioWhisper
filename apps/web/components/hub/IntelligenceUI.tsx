"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useWorkspaceResource } from "@/hooks/useWorkspaceResource";
import { Button } from "@/components/ui/Button";
import { Pagination, QuerySearch, ResourceState } from "./HubUI";

export function useLocalModels() {
  return useWorkspaceResource(
    (signal) => api.intelligence(signal),
    "local-models",
  );
}
export function LocalModelField({
  resource,
  value,
  onChange,
}: {
  resource: ReturnType<typeof useLocalModels>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="hub-label">
        Modelo local
        <select
          className="field"
          value={value}
          disabled={!resource.data?.models.length}
          onChange={(e) => onChange(e.target.value)}
        >
          {!resource.data?.models.length && (
            <option value="">
              {resource.loading
                ? "Consultando Ollama…"
                : "Nenhum modelo local disponível"}
            </option>
          )}
          {resource.data?.models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>
      {(resource.error || resource.data?.error) && (
        <p role="alert" className="hub-feedback text-warning">
          {resource.error || resource.data?.error}
        </p>
      )}
      {!resource.loading && !resource.data?.models.length && (
        <Button
          type="button"
          size="sm"
          className="mt-3"
          onClick={resource.refresh}
        >
          Consultar modelos novamente
        </Button>
      )}
    </div>
  );
}

export function RecordingPicker({
  project,
  selected,
  onChange,
  multiple = true,
}: {
  project: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
}) {
  const [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0);
  const resource = useWorkspaceResource(
    (signal) =>
      api.library(
        new URLSearchParams({
          project,
          q: query,
          status: "completed",
          offset: String(offset),
          limit: "12",
        }),
        signal,
      ),
    `${project}:${query}:${offset}`,
  );
  return (
    <div className="recording-picker">
      <QuerySearch
        current={query}
        commit={(value) => {
          setQuery(value);
          setOffset(0);
        }}
        label="Buscar gravações para selecionar"
        placeholder="Buscar uma gravação concluída"
      />
      <ResourceState
        {...resource}
        retry={resource.refresh}
        empty={
          resource.data?.items.length === 0
            ? {
                title: "Nenhuma gravação concluída",
                text: "Conclua uma transcrição ou ajuste o projeto e a busca.",
              }
            : undefined
        }
      >
        <fieldset>
          <legend>
            {multiple ? "Gravações da consulta" : "Gravação para a receita"}
          </legend>
          {resource.data?.items.map((item) => (
            <label key={item.job.id} className="recording-choice">
              <input
                type={multiple ? "checkbox" : "radio"}
                name={multiple ? undefined : "recipe-recording"}
                checked={selected.includes(item.job.id)}
                onChange={(e) =>
                  onChange(
                    multiple
                      ? e.target.checked
                        ? [...selected, item.job.id]
                        : selected.filter((id) => id !== item.job.id)
                      : [item.job.id],
                  )
                }
                disabled={
                  multiple &&
                  !selected.includes(item.job.id) &&
                  selected.length >= 20
                }
              />
              <span>
                {item.title || item.name}
                <small>{item.project || "Sem projeto"}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <Pagination
          page={resource.data}
          change={(value) => setOffset(Number(value))}
        />
      </ResourceState>
      {selected.length > 0 && (
        <div className="hub-inline-actions">
          <span>{selected.length} selecionada(s)</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange([])}
          >
            Limpar seleção
          </Button>
        </div>
      )}
    </div>
  );
}
