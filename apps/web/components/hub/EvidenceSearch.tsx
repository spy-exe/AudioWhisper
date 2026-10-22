"use client";
import Link from "next/link";
import { useWorkspaceResource } from "@/hooks/useWorkspaceResource";
import { workspaceApi, sourceUrl } from "@/lib/workspace-api";
import { formatTimestamp } from "@/lib/format";
import { Icon } from "@/components/ui/Icon";
import {
  HubPage,
  FilterDisclosure,
  Pagination,
  ProjectField,
  QuerySearch,
  ResourceState,
  useHubFilters,
} from "./HubUI";

export function EvidenceSearch() {
  const filters = useHubFilters(),
    q = filters.params.get("q") ?? "";
  const resource = useWorkspaceResource(
    (signal) =>
      workspaceApi.search(
        {
          q: q.trim().length < 2 ? "" : q,
          project: filters.params.get("project") ?? "",
          speaker: filters.params.get("speaker") ?? "",
          offset: filters.params.get("offset") ?? "0",
        },
        signal,
      ),
    filters.key,
  );
  return (
    <HubPage
      title="Buscar trechos"
      description="Encontre uma fala e abra o áudio no trecho correspondente."
    >
      <div className="search-stage">
        <QuerySearch
          current={q}
          commit={(value) => filters.change("q", value)}
          label="Buscar conteúdo nas gravações"
          placeholder="O que você quer encontrar?"
        />
        <FilterDisclosure
          count={
            [
              filters.params.get("project"),
              filters.params.get("speaker"),
            ].filter(Boolean).length
          }
        >
          <div className="hub-filter-row">
            <ProjectField
              value={filters.params.get("project") ?? ""}
              onChange={(value) => filters.change("project", value)}
            />
            <label className="hub-label">
              Falante
              <input
                key={filters.params.get("speaker") ?? ""}
                className="field"
                defaultValue={filters.params.get("speaker") ?? ""}
                placeholder="Nome ou identificação · Enter para aplicar"
                maxLength={128}
                onBlur={(e) => {
                  if (e.target.value !== (filters.params.get("speaker") ?? ""))
                    filters.change("speaker", e.target.value.trim());
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing)
                    e.currentTarget.blur();
                }}
              />
            </label>
          </div>
        </FilterDisclosure>
      </div>
      <ResourceState
        {...resource}
        retry={resource.refresh}
        empty={
          q.trim().length < 2
            ? {
                title: "Busque no conteúdo das gravações",
                text: "Digite pelo menos dois caracteres da transcrição.",
              }
            : resource.data?.items.length === 0
              ? {
                  title: "Nenhum trecho encontrado",
                  text: "Experimente outra expressão ou remova os filtros de projeto e falante.",
                }
              : undefined
        }
      >
        <div className="hub-results-heading">
          <h2>Trechos encontrados</h2>
          <span>{resource.data?.total ?? 0} resultados</span>
        </div>
        <ol className="evidence-results">
          {resource.data?.items.map((hit, i) => (
            <li key={hit.segment_id}>
              <div className="evidence-index">
                {String((resource.data?.offset ?? 0) + i + 1).padStart(2, "0")}
              </div>
              <article>
                <Link href={sourceUrl(hit)}>
                  <div className="evidence-meta">
                    <span>{hit.project || "Sem projeto"}</span>
                    <span>{hit.speaker}</span>
                    <time>{formatTimestamp(hit.start)}</time>
                  </div>
                  <h3>{hit.title}</h3>
                  <p className="evidence-hit-text">
                    {hit.snippet ? (
                      <>
                        {hit.snippet.before}
                        <mark>{hit.snippet.match}</mark>
                        {hit.snippet.after}
                      </>
                    ) : (
                      hit.text
                    )}
                  </p>
                  <span className="hub-text-link">
                    <Icon name="studio" />
                    Ouvir trecho · {formatTimestamp(hit.start)}
                    <Icon name="arrow" />
                  </span>
                </Link>
              </article>
            </li>
          ))}
        </ol>
        <Pagination
          page={resource.data}
          change={(value) => filters.change("offset", value)}
        />
      </ResourceState>
    </HubPage>
  );
}
