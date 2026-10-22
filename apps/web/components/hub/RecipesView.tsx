"use client";
import { DraftGuard } from "@/components/ui/WorkspaceDialog";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  useWorkspaceMutation,
  useWorkspaceResource,
} from "@/hooks/useWorkspaceResource";
import { workspaceApi, type Recipe, type RecipeRun } from "@/lib/workspace-api";
import { formatRelativeTime } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  HubPage,
  HubDisclosure,
  MutationFeedback,
  Pagination,
  ProjectField,
  ResourceState,
  useHubFilters,
} from "./HubUI";
import {
  LocalModelField,
  RecordingPicker,
  useLocalModels,
} from "./IntelligenceUI";

export const documentKinds = {
  minutes: "Ata técnica",
  briefing: "Briefing executivo",
  summary: "Resumo",
  decisions: "Decisões",
  actions: "Plano de ação",
  risks: "Riscos",
  questions: "Perguntas em aberto",
  email: "E-mail de acompanhamento",
  custom: "Análise personalizada",
};

function RecipeCard({
  recipe,
  refresh,
  refreshRuns,
}: {
  recipe: Recipe;
  refresh: () => void;
  refreshRuns: () => void;
}) {
  const mutation = useWorkspaceMutation();
  const [choosing, setChoosing] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [name, setName] = useState(recipe.name),
    [instruction, setInstruction] = useState(recipe.instruction);
  return (
    <article
      className={`recipe-card ${!recipe.enabled ? "recipe-disabled" : ""}`}
    >
      <header>
        <span className="recipe-symbol">
          <Icon name="workflow" />
        </span>
        <span className="hub-kicker">
          {recipe.project || "TODAS AS GRAVAÇÕES"}
        </span>
      </header>
      <h3>{recipe.name}</h3>
      <p>
        {documentKinds[recipe.kind as keyof typeof documentKinds]} ·{" "}
        {recipe.automatic ? "Automático" : "Manual"}
      </p>

      <details className="hub-disclosure">
        <summary>Automação e estado</summary>
        <div className="recipe-switches">
          <label className="hub-check">
            <input
              type="checkbox"
              checked={recipe.enabled}
              disabled={mutation.busy}
              onChange={async (e) => {
                const enabled = e.target.checked;
                if (
                  await mutation.execute(
                    () => workspaceApi.editRecipe(recipe, { enabled }),
                    enabled ? "Modelo habilitado." : "Modelo pausado.",
                  )
                )
                  refresh();
              }}
            />
            Modelo habilitado
          </label>
          <label className="hub-check">
            <input
              type="checkbox"
              checked={recipe.automatic}
              disabled={mutation.busy}
              onChange={async (e) => {
                const automatic = e.target.checked;
                if (
                  await mutation.execute(
                    () => workspaceApi.editRecipe(recipe, { automatic }),
                    automatic
                      ? "Geração automática ativada para novas conclusões."
                      : "Geração automática desativada.",
                  )
                )
                  refresh();
              }}
            />
            Preparar ao concluir gravação
          </label>
        </div>
        <p className="hub-field-hint">
          Execuções criam rascunhos. A revisão e o compartilhamento continuam
          nas suas mãos.
        </p>
      </details>
      <Button
        disabled={!recipe.enabled || mutation.busy}
        onClick={() => setChoosing(!choosing)}
        aria-expanded={choosing}
      >
        Escolher gravação para executar
      </Button>
      {choosing && (
        <div className="mt-4">
          <RecordingPicker
            project={recipe.project}
            selected={selected}
            onChange={setSelected}
            multiple={false}
          />
          <Button
            variant="primary"
            disabled={mutation.busy || !selected.length}
            onClick={async () => {
              if (
                await mutation.execute(
                  () => workspaceApi.runRecipe(recipe.id, selected[0]!),
                  "Execução registrada. Acompanhe o resultado abaixo.",
                )
              ) {
                setChoosing(false);
                setSelected([]);
                refreshRuns();
              }
            }}
          >
            Preparar documento
          </Button>
        </div>
      )}
      <details className="hub-disclosure">
        <summary>Editar nome e instruções</summary>
        <form
          noValidate
          className="hub-form mt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await mutation.execute(
                () => workspaceApi.editRecipe(recipe, { name, instruction }),
                "Modelo salvo. Novas execuções usam as instruções atualizadas.",
              )
            )
              refresh();
          }}
        >
          <DraftGuard
            dirty={name !== recipe.name || instruction !== recipe.instruction}
          />
          <label className="hub-label">
            Nome
            <input
              className="field"
              value={name}
              maxLength={128}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="hub-label">
            Instruções
            <textarea
              className="field min-h-32 resize-none"
              value={instruction}
              maxLength={4000}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={mutation.busy || !name.trim()}>
            Salvar instruções
          </Button>
        </form>
      </details>
      <MutationFeedback {...mutation} />
    </article>
  );
}

function RunCard({ run, refresh }: { run: RecipeRun; refresh: () => void }) {
  const mutation = useWorkspaceMutation();
  const statuses = {
    queued: "Na fila local",
    running: "Preparando documento",
    completed: "Rascunho preparado",
    failed: "Falha na execução",
  };
  return (
    <article className={`recipe-run run-${run.status}`}>
      <span className="run-state-icon">
        <Icon name={run.status === "completed" ? "file" : "workflow"} />
      </span>
      <div>
        <h3>{run.name}</h3>
        <p>
          {statuses[run.status]} · {formatRelativeTime(run.created_at)}
        </p>
        {run.error && (
          <p role="alert" className="text-danger">
            {run.error}
          </p>
        )}
        {run.status === "completed" && (
          <Link
            className="hub-text-link"
            href={`/jobs/${run.job_id}?document=${run.document_id ?? ""}`}
          >
            Revisar documento <Icon name="arrow" />
          </Link>
        )}
        {run.status === "failed" && (
          <Button
            size="sm"
            disabled={mutation.busy}
            onClick={async () => {
              if (
                await mutation.execute(
                  () => workspaceApi.retryRun(run.id),
                  "Execução adicionada à fila.",
                )
              )
                refresh();
            }}
          >
            Repetir execução
          </Button>
        )}
        <MutationFeedback {...mutation} />
      </div>
    </article>
  );
}

export function RecipesView() {
  const filters = useHubFilters(),
    project = filters.params.get("project") ?? "";
  const recipes = useWorkspaceResource(
    (signal) =>
      workspaceApi.recipes(
        { project, offset: filters.params.get("offset") ?? "0" },
        signal,
      ),
    filters.key,
  );
  const runs = useWorkspaceResource(
    (signal) =>
      workspaceApi.runs(
        { project, offset: filters.params.get("runs_offset") ?? "0" },
        signal,
      ),
    filters.key,
    3000,
  );
  const models = useLocalModels(),
    mutation = useWorkspaceMutation();
  const [name, setName] = useState(""),
    [kind, setKind] = useState("minutes"),
    [model, setModel] = useState(""),
    [instruction, setInstruction] = useState(""),
    [recipeProject, setRecipeProject] = useState(project),
    [automatic, setAutomatic] = useState(false);
  useEffect(() => {
    setRecipeProject(project);
  }, [project]);
  const effectiveModel = models.data?.models.includes(model)
    ? model
    : (models.data?.models[0] ?? "");
  return (
    <HubPage
      title="Modelos de documento"
      description="Salve instruções para preparar atas, resumos e planos de ação."
    >
      <div className="hub-collection-layout">
        <div className="min-w-0">
          <ProjectField
            value={project}
            onChange={(value) => filters.change("project", value)}
            label="Filtrar por projeto"
          />
          <ResourceState
            {...recipes}
            retry={recipes.refresh}
            empty={
              recipes.data?.items.length === 0
                ? {
                    title: "Nenhum modelo cadastrado",
                    text: "Crie um modelo e escolha uma gravação para preparar o documento.",
                  }
                : undefined
            }
          >
            <div className="recipe-grid">
              {recipes.data?.items.map((recipe) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  refresh={recipes.refresh}
                  refreshRuns={runs.refresh}
                />
              ))}
            </div>
            <Pagination
              page={recipes.data}
              change={(value) => filters.change("offset", value)}
            />
          </ResourceState>
        </div>
        <HubDisclosure title="Novo modelo de documento">
          <form
            noValidate
            className="hub-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutation.execute(
                  () =>
                    workspaceApi.createRecipe({
                      name: name.trim(),
                      project: recipeProject,
                      kind,
                      model: effectiveModel,
                      instruction,
                      automatic,
                    }),
                  "Modelo salvo.",
                )
              ) {
                setName("");
                setInstruction("");
                setAutomatic(false);
                recipes.refresh();
              }
            }}
          >
            <DraftGuard dirty={!!(name || instruction)} />
            <label className="hub-label">
              Nome do modelo
              <input
                className="field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={128}
                placeholder="Ex.: Ata de infraestrutura"
              />
            </label>
            <label className="hub-label">
              Documento
              <select
                className="field"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {Object.entries(documentKinds).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <ProjectField
              value={recipeProject}
              onChange={setRecipeProject}
              label="Projeto do modelo"
              allLabel="Todas as gravações"
            />
            <details className="hub-disclosure">
              <summary>Modelo de processamento</summary>
              <div className="pt-4">
                <LocalModelField
                  resource={models}
                  value={effectiveModel}
                  onChange={setModel}
                />
              </div>
            </details>
            <label className="hub-label">
              Instruções adicionais
              <textarea
                className="field min-h-32 resize-none"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                maxLength={4000}
                placeholder="Destaque impactos, riscos e próximos passos mencionados."
              />
            </label>
            <label className="hub-check">
              <input
                type="checkbox"
                checked={automatic}
                onChange={(e) => setAutomatic(e.target.checked)}
              />
              Preparar automaticamente após a conclusão
            </label>
            <p className="hub-field-hint">
              A opção automática vale para conclusões posteriores à criação da
              receita. Receitas de projeto também são verificadas ao organizar a
              gravação nesse projeto. Cada receita executa uma vez por gravação;
              falhas podem ser repetidas.
            </p>
            <Button
              type="submit"
              variant="primary"
              disabled={mutation.busy || !name.trim() || !effectiveModel}
            >
              Salvar modelo
            </Button>
            {!models.loading && !effectiveModel && (
              <p role="alert" className="text-warning">
                {models.error ||
                  models.data?.error ||
                  "Nenhum modelo de processamento disponível."}{" "}
                Abra “Modelo de processamento” para verificar a conexão.
              </p>
            )}
            <MutationFeedback {...mutation} />
          </form>
        </HubDisclosure>
      </div>
      <div className="hub-results-heading">
        <h2>Execuções e documentos</h2>
        <span>{runs.data?.total ?? 0} execuções</span>
      </div>
      <ResourceState
        {...runs}
        retry={runs.refresh}
        empty={
          runs.data?.items.length === 0
            ? {
                title: "Nenhum documento preparado",
                text: "Escolha uma gravação em um modelo cadastrado para começar.",
              }
            : undefined
        }
      >
        <div className="recipe-run-list">
          {runs.data?.items.map((run) => (
            <RunCard key={run.id} run={run} refresh={runs.refresh} />
          ))}
        </div>
        <Pagination
          page={runs.data}
          change={(value) => filters.change("runs_offset", value)}
        />
      </ResourceState>
    </HubPage>
  );
}
