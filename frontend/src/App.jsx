import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "./basePath";

const STATUSES = [
  { value: "todo", label: "Por hacer" },
  { value: "in_progress", label: "En progreso" },
  { value: "testing", label: "Probar" },
  { value: "done", label: "Hecha" },
];

const emptyTaskForm = {
  project_id: "",
  description: "",
  status: "todo",
};

const STATUS_ORDER = {
  todo: 0,
  in_progress: 1,
  testing: 2,
  done: 3,
};

const TABLE_PAGE_SIZES = [10, 20, 50];
const emptyProjectForm = {
  id: null,
  name: "",
  member_ids: [],
  logoFile: null,
  existing_logo_url: null,
  remove_logo: false,
};

function statusLabel(status) {
  return STATUSES.find((item) => item.value === status)?.label ?? status;
}

function compareValues(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "es-MX", { numeric: true, sensitivity: "base" });
}

function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function formatProgress(task) {
  return typeof task.progress_percent === "number" ? `${task.progress_percent}%` : null;
}

function formatChecklistSummary(task) {
  const checklistItems = getChecklistItems(task);
  if (!checklistItems.length) return null;
  const progress = formatProgress(task);
  return progress ? `${checklistItems.length} subtareas, ${progress} completado` : `${checklistItems.length} subtareas`;
}

function getProjectProgress(project) {
  const total = Number(project?.task_count) || 0;
  const pending = Number(project?.pending_count) || 0;
  const done = Math.max(0, total - pending);
  const donePercent = total > 0 ? Math.round((done / total) * 100) : 0;
  const tone = total === 0 ? "neutral" : donePercent > 50 ? "good" : donePercent >= 30 ? "warn" : "bad";
  return { total, pending, done, donePercent, tone, hasTasks: total > 0 };
}

function formatTableDate(value) {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatTimestampPair(createdAt, updatedAt) {
  const parts = [`Creado ${formatTableDate(createdAt)}`];
  if (updatedAt) {
    parts.push(`Actualizado ${formatTableDate(updatedAt)}`);
  }
  return parts.join(" · ");
}

function getChecklistItems(task) {
  return Array.isArray(task?.checklist_items) ? task.checklist_items : [];
}

function getSelectedTaskIdFromLocation() {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("task");
  const taskId = Number(value);
  return Number.isInteger(taskId) && taskId > 0 ? taskId : null;
}

function buildTaskPermalink(taskId) {
  if (typeof window === "undefined") return `?task=${taskId}`;
  const url = new URL(window.location.href);
  url.searchParams.set("task", String(taskId));
  return url.toString();
}

function syncSelectedTaskInUrl(taskId) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (taskId) {
    url.searchParams.set("task", String(taskId));
  } else {
    url.searchParams.delete("task");
  }
  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

async function parseResponse(response) {
  if (!response.ok) {
    let message = "La solicitud falló";
    try {
      const data = await response.json();
      message = data.description || data.message || message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }
  return response.json();
}

function apiPath(path) {
  return withBasePath(`/api${path}`);
}

function formatAuditAction(entry) {
  const actor = entry.username || "Usuario desconocido";
  return `${actor} · ${entry.details}`;
}

function ProjectIdentity({ name, logoUrl, compact = false }) {
  return (
    <div className={`project-identity ${compact ? "project-identity-compact" : ""}`}>
      {logoUrl ? (
        <img src={logoUrl} alt={`Logo de ${name}`} className="project-logo-mark" />
      ) : (
        <span className="project-logo-fallback" aria-hidden="true">
          {name?.slice(0, 1).toUpperCase() || "P"}
        </span>
      )}
      <span>{name}</span>
    </div>
  );
}

function compareTasksByRecency(left, right) {
  return compareValues(right.updated_at, left.updated_at) || compareValues(right.id, left.id);
}

function mergeTaskIntoBoard(currentBoard, updatedTask) {
  if (!currentBoard || String(currentBoard.project?.id) !== String(updatedTask.project_id)) {
    return currentBoard;
  }
  const columns = currentBoard.columns.map((column) => {
    const existingTasks = column.tasks.filter((task) => task.id !== updatedTask.id);
    if (column.status !== updatedTask.status) {
      return { ...column, tasks: existingTasks };
    }
    return { ...column, tasks: [...existingTasks, updatedTask].sort(compareTasksByRecency) };
  });
  return { ...currentBoard, columns };
}

function mergeTaskIntoList(currentTasks, updatedTask) {
  const hasTask = currentTasks.some((task) => task.id === updatedTask.id);
  if (!hasTask) return currentTasks;
  return currentTasks.map((task) => (task.id === updatedTask.id ? updatedTask : task)).sort(compareTasksByRecency);
}

function LoginPage({ loginForm, loggingIn, error, onChange, onSubmit }) {
  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-copy">
          <p className="login-eyebrow">Task Tracker</p>
          <h1>Iniciar sesion</h1>
          <p>Accede a la aplicacion con un usuario existente en la base de datos.</p>
        </div>
        <form className="login-form" onSubmit={onSubmit}>
          <label>
            <span>Usuario</span>
            <input
              type="text"
              name="username"
              value={loginForm.username}
              onChange={onChange}
              autoComplete="username"
              required
              autoFocus
            />
          </label>
          <label>
            <span>Contrasena</span>
            <input
              type="password"
              name="password"
              value={loginForm.password}
              onChange={onChange}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <div className="error-banner login-error">{error}</div> : null}
          <button type="submit" disabled={loggingIn}>
            {loggingIn ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}

function AttachmentGallery({ attachments, onDelete }) {
  if (!attachments?.length) return null;
  return (
    <div className="attachment-grid">
      {attachments.map((attachment) => (
        <article key={attachment.id} className="attachment-card">
          <a href={attachment.url} target="_blank" rel="noreferrer" className="attachment-link">
            {attachment.is_image ? (
              <img src={attachment.url} alt={attachment.original_name} className="attachment-thumb" />
            ) : (
              <div className="attachment-file">{attachment.original_name.split(".").pop()?.toUpperCase() || "FILE"}</div>
            )}
            <span>{attachment.original_name}</span>
          </a>
          {onDelete ? (
            <button type="button" className="attachment-delete" onClick={() => onDelete(attachment.id)}>
              Eliminar
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function ProjectModal({
  open,
  mode,
  projectForm,
  users,
  saving,
  onClose,
  onChangeName,
  onToggleMember,
  onLogoChange,
  onToggleRemoveLogo,
  onSubmit,
}) {
  if (!open) return null;
  const title = mode === "edit" ? "Editar proyecto" : "Agregar proyecto";
  const actionLabel = mode === "edit" ? "Guardar cambios" : "Crear proyecto";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            <p>Configura nombre, logo y usuarios vinculados al proyecto.</p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cerrar
          </button>
        </div>
        <form className="stacked-form" onSubmit={onSubmit}>
          <label className="stacked-field">
            <span>Nombre</span>
            <input
              type="text"
              placeholder="Nombre del proyecto"
              value={projectForm.name}
              onChange={(event) => onChangeName(event.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="stacked-field">
            <span>Logo</span>
            {(projectForm.logoFile || (projectForm.existing_logo_url && !projectForm.remove_logo)) ? (
              <div className="project-logo-preview">
                {projectForm.logoFile ? (
                  <span>{projectForm.logoFile.name}</span>
                ) : (
                  <img src={projectForm.existing_logo_url} alt={`Logo de ${projectForm.name || "proyecto"}`} />
                )}
              </div>
            ) : (
              <p className="empty-state">Sin logo configurado.</p>
            )}
            <input type="file" accept="image/*" onChange={(event) => onLogoChange(event.target.files?.[0] ?? null)} />
            {projectForm.existing_logo_url ? (
              <label className="checkbox-row">
                <input type="checkbox" checked={projectForm.remove_logo} onChange={(event) => onToggleRemoveLogo(event.target.checked)} />
                <span>Eliminar logo actual</span>
              </label>
            ) : null}
          </label>
          <fieldset className="member-picker">
            <legend>Usuarios vinculados</legend>
            {users.length ? (
              <div className="member-picker-grid">
                {users.map((user) => {
                  const checked = projectForm.member_ids.includes(user.id);
                  return (
                    <label key={user.id} className="member-choice">
                      <input type="checkbox" checked={checked} onChange={() => onToggleMember(user.id)} />
                      <span>
                        <strong>{user.username}</strong>
                        <small>{user.email || "Sin email"}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="empty-state">Todavia no hay usuarios disponibles.</p>
            )}
          </fieldset>
          <button type="submit" disabled={saving}>
            {saving ? "Guardando..." : actionLabel}
          </button>
        </form>
      </section>
    </div>
  );
}

function TaskTable({ tasks, onOpenTask }) {
  const [columnFilters, setColumnFilters] = useState({
    id: "",
    project_name: "",
    description: "",
    status: "",
    created_at: "",
    updated_at: "",
    last_updated_by: "",
  });
  const [sortConfig, setSortConfig] = useState({ key: "updated_at", direction: "desc" });
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZES[0]);
  const [page, setPage] = useState(1);

  const filteredTasks = useMemo(() => {
    const normalizedFilters = Object.fromEntries(
      Object.entries(columnFilters).map(([key, value]) => [key, value.trim().toLowerCase()]),
    );

    return tasks.filter((task) => {
      if (normalizedFilters.id && !String(task.id).includes(normalizedFilters.id)) return false;
      if (normalizedFilters.project_name && !task.project_name.toLowerCase().includes(normalizedFilters.project_name)) {
        return false;
      }
      if (normalizedFilters.description && !task.description.toLowerCase().includes(normalizedFilters.description)) {
        return false;
      }
      if (normalizedFilters.status && task.status !== normalizedFilters.status) return false;
      if (normalizedFilters.created_at && !String(task.created_at ?? "").toLowerCase().includes(normalizedFilters.created_at)) {
        return false;
      }
      if (normalizedFilters.updated_at && !String(task.updated_at ?? "").toLowerCase().includes(normalizedFilters.updated_at)) {
        return false;
      }
      if (
        normalizedFilters.last_updated_by &&
        !String(task.last_updated_by ?? "").toLowerCase().includes(normalizedFilters.last_updated_by)
      ) {
        return false;
      }
      return true;
    });
  }, [columnFilters, tasks]);

  const sortedTasks = useMemo(() => {
    const sorted = [...filteredTasks];
    sorted.sort((left, right) => {
      let comparison = 0;
      switch (sortConfig.key) {
        case "id":
          comparison = compareValues(left.id, right.id);
          break;
        case "project_name":
          comparison = compareValues(left.project_name, right.project_name);
          break;
        case "description":
          comparison = compareValues(left.description, right.description);
          break;
        case "status":
          comparison = compareValues(STATUS_ORDER[left.status], STATUS_ORDER[right.status]);
          break;
        case "created_at":
          comparison = compareValues(left.created_at, right.created_at);
          break;
        case "updated_at":
          comparison = compareValues(left.updated_at, right.updated_at);
          break;
        case "last_updated_by":
          comparison = compareValues(left.last_updated_by, right.last_updated_by);
          break;
        default:
          comparison = 0;
      }

      if (comparison === 0) {
        comparison = compareValues(left.id, right.id);
      }
      return sortConfig.direction === "asc" ? comparison : -comparison;
    });
    return sorted;
  }, [filteredTasks, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(sortedTasks.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const paginatedTasks = sortedTasks.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setPage(1);
  }, [columnFilters, pageSize, tasks.length]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const toggleSort = (key) => {
    setSortConfig((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: key === "updated_at" ? "desc" : "asc" };
    });
  };

  const sortIndicator = (key) => {
    if (sortConfig.key !== key) return "↕";
    return sortConfig.direction === "asc" ? "↑" : "↓";
  };

  const updateFilter = (key, value) => {
    setColumnFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="data-table-shell">
      <div className="data-table-toolbar">
        <div className="data-table-summary">
          <h2>Lista de tareas</h2>
          <span>
            {sortedTasks.length} de {tasks.length} tareas
          </span>
          <p className="data-table-note">Orden predeterminado: ultima actualizacion, del cambio mas reciente al mas antiguo.</p>
        </div>
        <label className="page-size-control">
          <span>Filas por pagina</span>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {TABLE_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tasks.length ? (
        <>
          <div className="data-table-scroll">
            <table className="task-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" className="sort-button" onClick={() => toggleSort("id")}>
                      ID <span>{sortIndicator("id")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => toggleSort("project_name")}>
                      Proyecto <span>{sortIndicator("project_name")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => toggleSort("description")}>
                      Descripcion <span>{sortIndicator("description")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => toggleSort("status")}>
                      Estado <span>{sortIndicator("status")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => toggleSort("created_at")}>
                      Creada <span>{sortIndicator("created_at")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => toggleSort("updated_at")}>
                      Ultima actualizacion <span>{sortIndicator("updated_at")}</span>
                    </button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => toggleSort("last_updated_by")}>
                      Ultimo cambio por <span>{sortIndicator("last_updated_by")}</span>
                    </button>
                  </th>
                </tr>
                <tr className="filter-row-head">
                  <th>
                    <input
                      type="search"
                      placeholder="Filtrar"
                      value={columnFilters.id}
                      onChange={(event) => updateFilter("id", event.target.value)}
                    />
                  </th>
                  <th>
                    <input
                      type="search"
                      placeholder="Filtrar"
                      value={columnFilters.project_name}
                      onChange={(event) => updateFilter("project_name", event.target.value)}
                    />
                  </th>
                  <th>
                    <input
                      type="search"
                      placeholder="Filtrar"
                      value={columnFilters.description}
                      onChange={(event) => updateFilter("description", event.target.value)}
                    />
                  </th>
                  <th>
                    <select value={columnFilters.status} onChange={(event) => updateFilter("status", event.target.value)}>
                      <option value="">Todos</option>
                      {STATUSES.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </th>
                  <th>
                    <input
                      type="search"
                      placeholder="2026-04-24"
                      value={columnFilters.created_at}
                      onChange={(event) => updateFilter("created_at", event.target.value)}
                    />
                  </th>
                  <th>
                    <input
                      type="search"
                      placeholder="2026-04-24"
                      value={columnFilters.updated_at}
                      onChange={(event) => updateFilter("updated_at", event.target.value)}
                    />
                  </th>
                  <th>
                    <input
                      type="search"
                      placeholder="Usuario"
                      value={columnFilters.last_updated_by}
                      onChange={(event) => updateFilter("last_updated_by", event.target.value)}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedTasks.length ? (
                  paginatedTasks.map((task) => (
                    <tr key={task.id} onClick={() => onOpenTask(task)}>
                      <td className="cell-id">#{task.id}</td>
                      <td>
                        <ProjectIdentity name={task.project_name} logoUrl={task.project_logo_url} compact />
                      </td>
                      <td className="cell-description">{truncateText(task.description, 140)}</td>
                      <td>
                        <span className={`status-pill status-${task.status}`}>{statusLabel(task.status)}</span>
                      </td>
                      <td>{formatTableDate(task.created_at)}</td>
                      <td>{formatTableDate(task.updated_at)}</td>
                      <td>{task.last_updated_by || "Sin registro"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" className="empty-state data-table-empty">
                      Ninguna tarea coincide con los filtros de la tabla.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination-bar">
            <span>
              Mostrando {sortedTasks.length ? pageStart + 1 : 0}-{Math.min(pageStart + paginatedTasks.length, sortedTasks.length)} de{" "}
              {sortedTasks.length}
            </span>
            <div className="pagination-actions">
              <button type="button" className="ghost-button" disabled={currentPage === 1} onClick={() => setPage(1)}>
                Primero
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={currentPage === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Anterior
              </button>
              <span className="page-indicator">
                Pagina {currentPage} de {totalPages}
              </span>
              <button
                type="button"
                className="ghost-button"
                disabled={currentPage === totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                Siguiente
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={currentPage === totalPages}
                onClick={() => setPage(totalPages)}
              >
                Ultima
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="empty-state">Ninguna tarea coincide con los filtros actuales.</p>
      )}
    </div>
  );
}

function ProjectTable({ projects, onOpenProject }) {
  return (
    <div className="data-table-shell">
      <div className="data-table-toolbar">
        <div className="data-table-summary">
          <h2>Proyectos</h2>
          <span>{projects.length} proyectos</span>
          <p className="data-table-note">Haz clic en una fila para editar nombre, logo y usuarios vinculados.</p>
        </div>
      </div>

      {projects.length ? (
        <div className="data-table-scroll">
          <table className="task-table project-table">
            <thead>
              <tr>
                <th>Proyecto</th>
                <th>📈 Progreso</th>
                <th>📋 Tareas</th>
                <th>⏳ Pendientes</th>
                <th title="Usuarios vinculados">👥</th>
                <th title="Emails configurados">✉️</th>
                <th title="Días desde el último cambio en una tarea">🕐 Último cambio</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const members = project.members || [];
                const membersWithEmail = members.filter((member) => member.email);
                const progress = getProjectProgress(project);
                const daysSinceLastChange = project.last_task_update
                  ? Math.floor((Date.now() - new Date(project.last_task_update).getTime()) / 86400000)
                  : null;
                return (
                  <tr
                    key={project.id}
                    className={progress.hasTasks ? `project-row project-row-${progress.tone}` : "project-row"}
                    onClick={() => onOpenProject(project.id)}
                  >
                    <td>
                      <ProjectIdentity name={project.name} logoUrl={project.logo_url} compact />
                    </td>
                    <td>
                      <div className="project-progress-cell">
                        <div className="project-progress-meta">
                          <span>{progress.hasTasks ? `${progress.donePercent}%` : "Sin tareas"}</span>
                          <small>{progress.hasTasks ? `${progress.pending}/${progress.total} pendientes` : ""}</small>
                        </div>
                        {progress.hasTasks ? (
                          <div className="project-progress-track" aria-hidden="true">
                            <span
                              className={`project-progress-fill project-progress-${progress.tone}`}
                              style={{ width: `${progress.donePercent}%` }}
                            />
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td>{project.task_count ?? 0}</td>
                    <td>{project.pending_count ?? 0}</td>
                    <td>{members.length}</td>
                    <td>{membersWithEmail.length}</td>
                    <td title={project.last_task_update ? `Último cambio: ${formatTableDate(project.last_task_update)}` : "Sin tareas"}>
                      {daysSinceLastChange === null
                        ? "—"
                        : daysSinceLastChange === 0
                        ? "Hoy"
                        : daysSinceLastChange === 1
                        ? "Ayer"
                        : `Hace ${daysSinceLastChange} días`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">Todavia no hay proyectos.</p>
      )}
    </div>
  );
}

function TaskCard({
  task,
  onSelect,
  draggable = false,
  variant = "list",
  isDragging = false,
  isSaving = false,
  onDragStateChange,
}) {
  const isList = variant === "list";
  const checklistSummary = formatChecklistSummary(task);

  return (
    <article
      className={`task-card task-card-${variant} ${isDragging ? "is-dragging" : ""} ${isSaving ? "is-saving" : ""}`}
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable) return;
        event.dataTransfer.setData("text/plain", String(task.id));
        event.dataTransfer.effectAllowed = "move";
        onDragStateChange?.(task.id);
      }}
      onDragEnd={() => {
        onDragStateChange?.(null);
      }}
      onClick={() => onSelect(task)}
    >
      <div className="task-card-header">
        <ProjectIdentity name={task.project_name} logoUrl={task.project_logo_url} compact />
        {!isList ? <span className={`status-pill status-${task.status}`}>{statusLabel(task.status)}</span> : null}
      </div>
      {isList ? (
        <div className="task-card-description-row">
          <p>{truncateText(task.description, 250)}</p>
          <span className={`status-pill status-${task.status}`}>{statusLabel(task.status)}</span>
        </div>
      ) : (
        <p>{task.description}</p>
      )}
      <div className="task-card-meta">
        <span>{task.comments.length} comentarios</span>
        <span>{task.attachments.length} archivos</span>
        {checklistSummary ? <span>{checklistSummary}</span> : null}
      </div>
    </article>
  );
}

function TaskDetail({
  task,
  loading,
  currentUser,
  onBack,
  onAddComment,
  onUploadTaskAttachments,
  onDeleteAttachment,
  onStatusChange,
  onAddChecklistItem,
  onToggleChecklistItem,
  onDeleteChecklistItem,
  onUpdateDescription,
}) {
  const [commentBody, setCommentBody] = useState("");
  const [commentFiles, setCommentFiles] = useState([]);
  const [taskFiles, setTaskFiles] = useState([]);
  const [checklistBody, setChecklistBody] = useState("");
  const [activeDetailTab, setActiveDetailTab] = useState("comments");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingTaskFiles, setUploadingTaskFiles] = useState(false);
  const [savingChecklistItem, setSavingChecklistItem] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionEdit, setDescriptionEdit] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);

  if (loading) {
    return (
      <section className="detail-panel detail-panel-full">
        <div className="detail-panel-header">
          <button className="ghost-button" onClick={onBack}>
            Volver
          </button>
        </div>
        <p className="empty-state">Cargando tarea...</p>
      </section>
    );
  }

  if (!task) return null;

  const permalink = buildTaskPermalink(task.id);
  const progress = formatProgress(task);
  const checklistItems = getChecklistItems(task);
  const checklistSummary = formatChecklistSummary(task);

  const submitComment = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onAddComment(task.id, commentBody, commentFiles);
      setCommentBody("");
      setCommentFiles([]);
    } finally {
      setSubmitting(false);
    }
  };

  const submitTaskAttachments = async (event) => {
    event.preventDefault();
    if (!taskFiles.length) return;
    setUploadingTaskFiles(true);
    try {
      await onUploadTaskAttachments(task.id, taskFiles);
      setTaskFiles([]);
    } finally {
      setUploadingTaskFiles(false);
    }
  };

  const submitChecklistItem = async (event) => {
    event.preventDefault();
    setSavingChecklistItem(true);
    try {
      await onAddChecklistItem(task.id, checklistBody);
      setChecklistBody("");
    } finally {
      setSavingChecklistItem(false);
    }
  };

  const startEditingDescription = () => {
    setDescriptionEdit(task.description);
    setEditingDescription(true);
  };

  const cancelEditingDescription = () => {
    setEditingDescription(false);
    setDescriptionEdit("");
  };

  const submitDescription = async () => {
    if (!descriptionEdit.trim() || descriptionEdit.trim() === task.description) {
      cancelEditingDescription();
      return;
    }
    setSavingDescription(true);
    try {
      await onUpdateDescription(task.id, descriptionEdit.trim());
      setEditingDescription(false);
      setDescriptionEdit("");
    } finally {
      setSavingDescription(false);
    }
  };

  return (
    <section className="detail-panel detail-panel-full">
      <div className="detail-panel-header">
        <div className="detail-panel-title">
          <div className="detail-header-topline">
            <div className="detail-header-summary">
              <ProjectIdentity name={task.project_name} logoUrl={task.project_logo_url} />
              <div className="detail-task-heading">
                <h2>Tarea #{task.id}</h2>
                <p className="detail-task-meta">
                  {task.comments.length} comentarios · {task.attachments.length} archivos
                  {checklistSummary ? ` · ${checklistSummary}` : ""}
                </p>
                <p className="detail-timestamp-meta">{formatTimestampPair(task.created_at, task.updated_at)}</p>
              </div>
            </div>
            <div className="detail-panel-actions">
              <span className={`status-pill status-${task.status}`}>{statusLabel(task.status)}</span>
              <label className="detail-status-control">
                <span>Estado</span>
                <select
                  value={task.status}
                  disabled={!currentUser}
                  onChange={(event) => onStatusChange(task.id, event.target.value)}
                >
                  {STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>
              <a className="ghost-button" href={permalink}>
                Enlace permanente
              </a>
              <button className="ghost-button" onClick={onBack}>
                Volver
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="detail-section detail-section-summary">
        <div className="detail-description-card">
          {editingDescription ? (
            <div className="description-edit-form">
              <textarea
                rows="5"
                value={descriptionEdit}
                onChange={(event) => setDescriptionEdit(event.target.value)}
                disabled={savingDescription}
              />
              <div className="description-edit-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={cancelEditingDescription}
                  disabled={savingDescription}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={submitDescription}
                  disabled={savingDescription || !descriptionEdit.trim()}
                >
                  {savingDescription ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          ) : (
            <div className="description-display">
              <p>{task.description}</p>
              {currentUser && (
                <button
                  type="button"
                  className="ghost-button edit-description-button"
                  onClick={startEditingDescription}
                >
                  Editar descripcion
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="detail-section detail-section-compact">
        <div className="section-heading">
          <h3>Archivos adjuntos</h3>
          <form className="attachment-upload-form" onSubmit={submitTaskAttachments}>
            <input
              type="file"
              multiple
              disabled={!currentUser}
              onChange={(event) => setTaskFiles(Array.from(event.target.files || []))}
            />
            <button type="submit" disabled={uploadingTaskFiles || !taskFiles.length || !currentUser}>
              {uploadingTaskFiles ? "Subiendo..." : "Subir archivos"}
            </button>
          </form>
        </div>
        {task.attachments.length ? (
          <AttachmentGallery attachments={task.attachments} onDelete={currentUser ? onDeleteAttachment : null} />
        ) : (
          <p className="empty-state">Todavia no hay archivos adjuntos en la tarea.</p>
        )}
      </div>
      <div className="detail-section detail-section-compact">
        <div className="section-heading">
          <h3>Lista de verificacion</h3>
          {progress ? <span className="checklist-progress">{progress} completado</span> : null}
        </div>
        {checklistItems.length ? (
          <div className="checklist-list">
            {checklistItems.map((item) => (
              <div key={item.id} className={`checklist-item ${item.is_done ? "is-done" : ""}`}>
                <label className="checklist-toggle">
                  <input
                    type="checkbox"
                    checked={item.is_done}
                    disabled={!currentUser}
                    onChange={(event) => onToggleChecklistItem(item.id, event.target.checked)}
                  />
                  <span>{item.body}</span>
                </label>
                <button
                  type="button"
                  className="ghost-button danger-button"
                  disabled={!currentUser}
                  onClick={() => onDeleteChecklistItem(item.id)}
                >
                  Eliminar
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">Todavia no hay lista de verificacion. Agrega elementos si esta tarea necesita seguimiento paso a paso.</p>
        )}
        <form className="checklist-form" onSubmit={submitChecklistItem}>
          <input
            type="text"
            placeholder="Agregar elemento"
            value={checklistBody}
            onChange={(event) => setChecklistBody(event.target.value)}
          />
          <button type="submit" disabled={savingChecklistItem || !checklistBody.trim() || !currentUser}>
            {savingChecklistItem ? "Guardando..." : "Agregar elemento"}
          </button>
        </form>
      </div>
      <div className="detail-section detail-activity-panel">
        <div className="detail-tabs" role="tablist" aria-label="Detalle de actividad">
          <button
            type="button"
            role="tab"
            className={`detail-tab ${activeDetailTab === "comments" ? "is-active" : ""}`}
            aria-selected={activeDetailTab === "comments"}
            onClick={() => setActiveDetailTab("comments")}
          >
            Comentarios
          </button>
          <button
            type="button"
            role="tab"
            className={`detail-tab ${activeDetailTab === "history" ? "is-active" : ""}`}
            aria-selected={activeDetailTab === "history"}
            onClick={() => setActiveDetailTab("history")}
          >
            Historial de cambios
          </button>
        </div>
        {activeDetailTab === "comments" ? (
          <>
            <div className="comment-list">
              {task.comments.length ? (
                task.comments.map((comment) => (
                  <article key={comment.id} className="comment-card">
                    <div className="comment-meta">
                      <strong>{comment.username || "Usuario desconocido"}</strong>
                      <small>{formatTimestampPair(comment.created_at, comment.updated_at)}</small>
                    </div>
                    <p>{comment.body}</p>
                    <AttachmentGallery attachments={comment.attachments} onDelete={currentUser ? onDeleteAttachment : null} />
                  </article>
                ))
              ) : (
                <p className="empty-state">Todavia no hay comentarios.</p>
              )}
            </div>
            <form className="inline-form" onSubmit={submitComment}>
              <textarea
                rows="4"
                placeholder="Agrega notas de implementacion, contexto del error o detalles de seguimiento"
                value={commentBody}
                disabled={!currentUser}
                onChange={(event) => setCommentBody(event.target.value)}
                required
              />
              <input
                type="file"
                multiple
                disabled={!currentUser}
                onChange={(event) => setCommentFiles(Array.from(event.target.files || []))}
              />
              <button type="submit" disabled={submitting || !currentUser}>
                {submitting ? "Guardando..." : "Agregar comentario"}
              </button>
            </form>
            {!currentUser ? <p className="empty-state">Inicia sesion para comentar o modificar la tarea.</p> : null}
          </>
        ) : (
          <div className="audit-list">
            {task.audit_logs?.length ? (
              task.audit_logs.map((entry) => (
                <article key={entry.id} className="audit-card">
                  <p>{formatAuditAction(entry)}</p>
                  <small>{new Date(entry.created_at).toLocaleString("es-MX")}</small>
                </article>
              ))
            ) : (
              <p className="empty-state">Todavia no hay eventos de auditoria.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [board, setBoard] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(() => getSelectedTaskIdFromLocation());
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedTaskLoading, setSelectedTaskLoading] = useState(false);
  const [view, setView] = useState("list");
  const [filters, setFilters] = useState({ q: "" });
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [taskForm, setTaskForm] = useState(emptyTaskForm);
  const [taskFiles, setTaskFiles] = useState([]);
  const [projectForm, setProjectForm] = useState(emptyProjectForm);
  const [projectModalMode, setProjectModalMode] = useState("create");
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState(null);
  const [movingTaskId, setMovingTaskId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingTask, setSavingTask] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [error, setError] = useState("");

  const requireAuth = () => {
    if (currentUser) return true;
    setError("Debes iniciar sesion para modificar datos");
    return false;
  };

  const loadCurrentUser = async () => {
    setAuthLoading(true);
    try {
      const data = await parseResponse(await fetch(apiPath("/auth/me")));
      setCurrentUser(data.user);
      return data.user;
    } finally {
      setAuthLoading(false);
    }
  };

  const loadProjects = async () => {
    const data = await parseResponse(await fetch(apiPath("/projects")));
    setProjects(data);
    return data;
  };

  const loadUsers = async () => {
    const data = await parseResponse(await fetch(apiPath("/users")));
    setUsers(data);
    return data;
  };

  const loadSelectedTask = async (taskId) => {
    if (!taskId) {
      setSelectedTaskLoading(false);
      setSelectedTask(null);
      return null;
    }
    setSelectedTaskLoading(true);
    try {
      const data = await parseResponse(await fetch(apiPath(`/tasks/${taskId}`)));
      setSelectedTask(data);
      return data;
    } finally {
      setSelectedTaskLoading(false);
    }
  };

  const loadTasks = async (nextFilters = filters) => {
    const params = new URLSearchParams();
    if (nextFilters.q) params.set("q", nextFilters.q);
    const suffix = params.toString();
    const data = await parseResponse(await fetch(apiPath(`/tasks${suffix ? `?${suffix}` : ""}`)));
    setTasks(data);
    if (selectedTaskId) {
      const refreshed = data.find((task) => task.id === selectedTaskId);
      if (refreshed) {
        setSelectedTask(refreshed);
      }
    }
    return data;
  };

  const loadBoard = async (projectId) => {
    if (!projectId) {
      setBoard(null);
      return null;
    }
    const data = await parseResponse(await fetch(apiPath(`/projects/${projectId}/board`)));
    setBoard(data);
    if (selectedTaskId) {
      const refreshed = data.columns.flatMap((column) => column.tasks).find((task) => task.id === selectedTaskId);
      if (refreshed) {
        setSelectedTask(refreshed);
      }
    }
    return data;
  };

  const refreshAll = async (nextFilters = filters, nextProjectId = selectedProjectId) => {
    setLoading(true);
    setError("");
    try {
      const [loadedProjects] = await Promise.all([loadProjects(), loadUsers()]);
      const effectiveProjectId = nextProjectId || loadedProjects[0]?.id || "";
      setSelectedProjectId((current) => current || String(effectiveProjectId || ""));
      await Promise.all([loadTasks(nextFilters), loadBoard(effectiveProjectId)]);
      if (!taskForm.project_id && loadedProjects[0]?.id) {
        setTaskForm((current) => ({ ...current, project_id: String(loadedProjects[0].id) }));
      }
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCurrentUser().catch((nextError) => {
      setError(nextError.message);
      setAuthLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    refreshAll().catch((nextError) => setError(nextError.message));
  }, [currentUser]);

  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedTaskLoading(false);
      setSelectedTask(null);
      return;
    }
    if (selectedTask?.id === selectedTaskId) return;
    loadSelectedTask(selectedTaskId).catch((nextError) => {
      setError(nextError.message);
      setSelectedTaskId(null);
      setSelectedTask(null);
      syncSelectedTaskInUrl(null);
    });
  }, [selectedTaskId]);

  useEffect(() => {
    loadTasks(filters).catch((nextError) => setError(nextError.message));
  }, [filters.q]);

  useEffect(() => {
    loadBoard(selectedProjectId).catch((nextError) => setError(nextError.message));
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId && projects[0]?.id) {
      setSelectedProjectId(String(projects[0].id));
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    const onPopState = () => {
      const taskId = getSelectedTaskIdFromLocation();
      setSelectedTaskId(taskId);
      if (!taskId) {
        setSelectedTask(null);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const projectOptions = useMemo(
    () => projects.map((project) => ({ value: String(project.id), label: project.name })),
    [projects],
  );

  const openCreateProjectModal = () => {
    setProjectModalMode("create");
    setProjectForm({
      ...emptyProjectForm,
      member_ids: currentUser ? [currentUser.id] : [],
    });
    setIsProjectModalOpen(true);
  };

  const openEditProjectModal = (projectId) => {
    const project = projects.find((item) => String(item.id) === String(projectId));
    if (!project) {
      setError("Selecciona un proyecto para editarlo");
      return;
    }
    setProjectModalMode("edit");
    setProjectForm({
      id: project.id,
      name: project.name,
      member_ids: (project.members || []).map((member) => member.id),
      logoFile: null,
      existing_logo_url: project.logo_url || null,
      remove_logo: false,
    });
    setIsProjectModalOpen(true);
  };

  const toggleProjectMember = (userId) => {
    setProjectForm((current) => ({
      ...current,
      member_ids: current.member_ids.includes(userId)
        ? current.member_ids.filter((memberId) => memberId !== userId)
        : [...current.member_ids, userId].sort((left, right) => left - right),
    }));
  };

  const buildProjectPayload = () => {
    const formData = new FormData();
    formData.set(
      "data",
      JSON.stringify({
        name: projectForm.name,
        member_ids: projectForm.member_ids,
        remove_logo: projectForm.remove_logo,
      }),
    );
    if (projectForm.logoFile) {
      formData.set("logo", projectForm.logoFile);
    }
    return formData;
  };

  const submitProject = async (event) => {
    event.preventDefault();
    if (!requireAuth()) return;
    setSavingProject(true);
    setError("");
    try {
      const isEditing = projectModalMode === "edit" && projectForm.id;
      const project = await parseResponse(
        await fetch(apiPath(isEditing ? `/projects/${projectForm.id}` : "/projects"), {
          method: isEditing ? "PATCH" : "POST",
          body: buildProjectPayload(),
        }),
      );
      const nextProjects = isEditing
        ? projects.map((item) => (item.id === project.id ? project : item)).sort((a, b) => a.name.localeCompare(b.name))
        : [...projects, project].sort((a, b) => a.name.localeCompare(b.name));
      setProjects(nextProjects);
      setSelectedProjectId(String(project.id));
      setTaskForm((current) => ({ ...current, project_id: String(project.id) }));
      setProjectForm(emptyProjectForm);
      setIsProjectModalOpen(false);
      await Promise.all([loadTasks(filters), loadBoard(selectedProjectId || project.id)]);
      if (selectedTaskId) {
        await loadSelectedTask(selectedTaskId);
      }
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSavingProject(false);
    }
  };

  const createTask = async (event) => {
    event.preventDefault();
    if (!requireAuth()) return;
    setSavingTask(true);
    setError("");
    const formData = new FormData();
    formData.set("data", JSON.stringify({ ...taskForm, project_id: Number(taskForm.project_id) }));
    taskFiles.forEach((file) => formData.append("attachments", file));

    try {
      const createdTask = await parseResponse(
        await fetch(apiPath("/tasks"), {
          method: "POST",
          body: formData,
        }),
      );
      setTaskForm((current) => ({ ...emptyTaskForm, project_id: current.project_id || taskForm.project_id }));
      setTaskFiles([]);
      setSelectedTaskId(createdTask.id);
      setSelectedTaskLoading(false);
      setSelectedTask(createdTask);
      syncSelectedTaskInUrl(createdTask.id);
      await refreshAll(filters, selectedProjectId || createdTask.project_id);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSavingTask(false);
    }
  };

  const updateTaskStatus = async (taskId, status) => {
    if (!requireAuth()) return;
    setError("");
    const numericTaskId = Number(taskId);
    const optimisticTask =
      board?.columns.flatMap((column) => column.tasks).find((task) => task.id === numericTaskId) ||
      tasks.find((task) => task.id === numericTaskId) ||
      (selectedTask?.id === numericTaskId ? selectedTask : null);
    const previousBoard = board;
    const previousTasks = tasks;
    const previousSelectedTask = selectedTask;

    if (optimisticTask && optimisticTask.status !== status) {
      const nextTask = {
        ...optimisticTask,
        status,
        updated_at: new Date().toISOString(),
      };
      setBoard((current) => mergeTaskIntoBoard(current, nextTask));
      setTasks((current) => mergeTaskIntoList(current, nextTask));
      if (selectedTask?.id === numericTaskId) {
        setSelectedTask(nextTask);
      }
    }

    setMovingTaskId(numericTaskId);
    try {
      const updatedTask = await parseResponse(
        await fetch(apiPath(`/tasks/${taskId}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }),
      );
      setBoard((current) => mergeTaskIntoBoard(current, updatedTask));
      setTasks((current) => mergeTaskIntoList(current, updatedTask));
      if (selectedTask?.id === numericTaskId) {
        setSelectedTask(updatedTask);
      }
    } catch (nextError) {
      setBoard(previousBoard);
      setTasks(previousTasks);
      setSelectedTask(previousSelectedTask);
      setError(nextError.message);
    } finally {
      setMovingTaskId(null);
    }
  };

  const updateTaskDescription = async (taskId, description) => {
    if (!requireAuth()) return;
    setError("");
    try {
      const updatedTask = await parseResponse(
        await fetch(apiPath(`/tasks/${taskId}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description }),
        }),
      );
      setSelectedTask(updatedTask);
      await refreshAll(filters, selectedProjectId);
    } catch (nextError) {
      setError(nextError.message);
    }
  };

  const addComment = async (taskId, body, attachments) => {
    if (!requireAuth()) return;
    const formData = new FormData();
    formData.set("body", body);
    attachments.forEach((file) => formData.append("attachments", file));
    const updatedTask = await parseResponse(
      await fetch(apiPath(`/tasks/${taskId}/comments`), {
        method: "POST",
        body: formData,
      }),
    );
    setSelectedTaskLoading(false);
    setSelectedTask(updatedTask);
    setSelectedTaskId(updatedTask.id);
    await refreshAll(filters, selectedProjectId);
  };

  const uploadTaskAttachments = async (taskId, attachments) => {
    if (!requireAuth()) return;
    const formData = new FormData();
    attachments.forEach((file) => formData.append("attachments", file));
    const updatedTask = await parseResponse(
      await fetch(apiPath(`/tasks/${taskId}/attachments`), {
        method: "POST",
        body: formData,
      }),
    );
    setSelectedTaskLoading(false);
    setSelectedTask(updatedTask);
    setSelectedTaskId(updatedTask.id);
    await refreshAll(filters, selectedProjectId);
  };

  const deleteAttachment = async (attachmentId) => {
    if (!requireAuth()) return;
    setError("");
    try {
      const updatedTask = await parseResponse(
        await fetch(apiPath(`/attachments/${attachmentId}`), {
          method: "DELETE",
        }),
      );
      setSelectedTaskLoading(false);
      setSelectedTask(updatedTask);
      setSelectedTaskId(updatedTask.id);
      await refreshAll(filters, selectedProjectId);
    } catch (nextError) {
      setError(nextError.message);
    }
  };

  const addChecklistItem = async (taskId, body) => {
    if (!requireAuth()) return;
    setError("");
    try {
      const updatedTask = await parseResponse(
        await fetch(apiPath(`/tasks/${taskId}/checklist`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        }),
      );
      setSelectedTaskLoading(false);
      setSelectedTask(updatedTask);
      setSelectedTaskId(updatedTask.id);
      await refreshAll(filters, selectedProjectId);
    } catch (nextError) {
      setError(nextError.message);
    }
  };

  const toggleChecklistItem = async (itemId, isDone) => {
    if (!requireAuth()) return;
    setError("");
    try {
      const updatedTask = await parseResponse(
        await fetch(apiPath(`/checklist-items/${itemId}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_done: isDone }),
        }),
      );
      setSelectedTaskLoading(false);
      setSelectedTask(updatedTask);
      setSelectedTaskId(updatedTask.id);
      await refreshAll(filters, selectedProjectId);
    } catch (nextError) {
      setError(nextError.message);
    }
  };

  const deleteChecklistItem = async (itemId) => {
    if (!requireAuth()) return;
    setError("");
    try {
      const updatedTask = await parseResponse(
        await fetch(apiPath(`/checklist-items/${itemId}`), {
          method: "DELETE",
        }),
      );
      setSelectedTaskLoading(false);
      setSelectedTask(updatedTask);
      setSelectedTaskId(updatedTask.id);
      await refreshAll(filters, selectedProjectId);
    } catch (nextError) {
      setError(nextError.message);
    }
  };

  const openTask = (task) => {
    setSelectedTaskId(task.id);
    setSelectedTaskLoading(false);
    setSelectedTask(task);
    syncSelectedTaskInUrl(task.id);
  };

  const closeTask = () => {
    setSelectedTaskId(null);
    setSelectedTaskLoading(false);
    setSelectedTask(null);
    syncSelectedTaskInUrl(null);
  };

  const switchView = (nextView) => {
    setView(nextView);
    if (selectedTaskId) {
      closeTask();
    }
  };

  const onBoardDrop = async (event, status) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain");
    if (!taskId) return;
    await updateTaskStatus(taskId, status);
    setDraggingTaskId(null);
  };

  const login = async (event) => {
    event.preventDefault();
    setLoggingIn(true);
    setError("");
    try {
      const data = await parseResponse(
        await fetch(apiPath("/auth/login"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(loginForm),
        }),
      );
      setCurrentUser(data.user);
      setLoginForm({ username: "", password: "" });
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = async () => {
    setError("");
    try {
      await parseResponse(
        await fetch(apiPath("/auth/logout"), {
          method: "POST",
        }),
      );
      setCurrentUser(null);
      setSelectedTaskId(null);
      setSelectedTask(null);
      setBoard(null);
      setTasks([]);
      setUsers([]);
      setProjects([]);
      setProjectForm(emptyProjectForm);
      syncSelectedTaskInUrl(null);
    } catch (nextError) {
      setError(nextError.message);
    }
  };

  if (authLoading) {
    return (
      <main className="login-shell">
        <section className="login-panel login-panel-loading">
          <p className="empty-state">Verificando sesion...</p>
        </section>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <LoginPage
        loginForm={loginForm}
        loggingIn={loggingIn}
        error={error}
        onChange={(event) => {
          const { name, value } = event.target;
          setLoginForm((current) => ({ ...current, [name]: value }));
        }}
        onSubmit={login}
      />
    );
  }

  return (
    <div className="app-shell">
      {error ? <div className="error-banner">{error}</div> : null}

      <ProjectModal
        open={isProjectModalOpen}
        mode={projectModalMode}
        projectForm={projectForm}
        users={users}
        saving={savingProject}
        onClose={() => {
          if (savingProject) return;
          setIsProjectModalOpen(false);
          setProjectForm(emptyProjectForm);
        }}
        onChangeName={(value) => setProjectForm((current) => ({ ...current, name: value }))}
        onToggleMember={toggleProjectMember}
        onLogoChange={(file) =>
          setProjectForm((current) => ({
            ...current,
            logoFile: file,
            remove_logo: file ? false : current.remove_logo,
          }))
        }
        onToggleRemoveLogo={(checked) =>
          setProjectForm((current) => ({
            ...current,
            remove_logo: checked,
            logoFile: checked ? null : current.logoFile,
          }))
        }
        onSubmit={submitProject}
      />

      <header className="topbar">
        <section className="toolbar">
          <div className="toolbar-brand">
            <span className="toolbar-title">Task Tracker</span>
          </div>
          <div className="filter-row">
            <label className="search-field">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="search-icon">
                <path
                  d="M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13Zm0-2a8.5 8.5 0 1 1 5.33 15.12l4.52 4.53l-1.41 1.41l-4.53-4.52A8.5 8.5 0 0 1 10.5 2Z"
                  fill="currentColor"
                />
              </svg>
              <input
                type="search"
                placeholder="Buscar tareas, proyectos o texto en comentarios"
                value={filters.q}
                onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
              />
            </label>
            <div className="view-switch">
              <button className={view === "list" ? "active" : ""} onClick={() => switchView("list")}>
                Lista
              </button>
              <button className={view === "board" ? "active" : ""} onClick={() => switchView("board")}>
                Kanban
              </button>
              <button className={view === "projects" ? "active" : ""} onClick={() => switchView("projects")}>
                Proyectos
              </button>
            </div>
          </div>
          <div className="toolbar-actions">
            <div className="project-form">
              <button type="button" onClick={openCreateProjectModal}>
                Agregar proyecto
              </button>
            </div>
            <details className="user-menu">
              <summary className="user-menu-trigger">
                <span>{currentUser.username}</span>
                <span className="user-menu-caret" aria-hidden="true">
                  ▾
                </span>
              </summary>
              <div className="user-menu-popover">
                <button type="button" className="user-menu-item" onClick={logout}>
                  Cerrar sesion
                </button>
              </div>
            </details>
          </div>
        </section>
      </header>

      <main
        className={`layout ${view === "board" || view === "projects" ? "layout-board" : ""} ${selectedTaskId ? "layout-task-open" : ""}`}
      >
        {selectedTaskId ? (
        <TaskDetail
          task={selectedTask}
          loading={selectedTaskLoading}
          currentUser={currentUser}
          onBack={closeTask}
          onAddComment={addComment}
          onUploadTaskAttachments={uploadTaskAttachments}
          onDeleteAttachment={deleteAttachment}
          onStatusChange={updateTaskStatus}
          onAddChecklistItem={addChecklistItem}
          onToggleChecklistItem={toggleChecklistItem}
          onDeleteChecklistItem={deleteChecklistItem}
          onUpdateDescription={updateTaskDescription}
        />
        ) : (
          <>
            {view === "list" ? (
              <section className="panel composer">
                <h2>Crear tarea</h2>
                <form className="stacked-form" onSubmit={createTask}>
                  <select
                    value={taskForm.project_id}
                    onChange={(event) => setTaskForm((current) => ({ ...current, project_id: event.target.value }))}
                    required
                  >
                    <option value="">Elegir proyecto</option>
                    {projectOptions.map((project) => (
                      <option key={project.value} value={project.value}>
                        {project.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    rows="5"
                    placeholder="Describe el error, funcionalidad, investigacion o tarea de seguimiento"
                    value={taskForm.description}
                    onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))}
                    required
                  />
                  <select
                    value={taskForm.status}
                    onChange={(event) => setTaskForm((current) => ({ ...current, status: event.target.value }))}
                  >
                    {STATUSES.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                  <input type="file" multiple onChange={(event) => setTaskFiles(Array.from(event.target.files || []))} />
                  <button type="submit" disabled={savingTask || !currentUser}>
                    {savingTask ? "Guardando..." : "Crear tarea"}
                  </button>
                  {!currentUser ? <p className="empty-state">Inicia sesion para crear tareas.</p> : null}
                </form>
              </section>
            ) : null}

            <section className="panel main-panel">
              {loading ? (
                <p className="empty-state">Cargando...</p>
              ) : view === "list" ? (
                <TaskTable tasks={tasks} onOpenTask={openTask} />
              ) : view === "projects" ? (
                <ProjectTable projects={projects} onOpenProject={openEditProjectModal} />
              ) : (
                <>
                  <div className="panel-header">
                    <h2>Kanban del proyecto</h2>
                    <label className="board-project-control">
                      <span>Proyecto</span>
                      <select
                        value={selectedProjectId}
                        onChange={(event) => setSelectedProjectId(event.target.value)}
                      >
                        <option value="">Elegir proyecto</option>
                        {projectOptions.map((project) => (
                          <option key={project.value} value={project.value}>
                            {project.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {board ? (
                    <div className="kanban-grid">
                      {board.columns.map((column) => (
                        <section
                          key={column.status}
                          className="kanban-column"
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => onBoardDrop(event, column.status)}
                        >
                          <div className="kanban-column-header">
                            <h3>{statusLabel(column.status)}</h3>
                            <span>{column.tasks.length}</span>
                          </div>
                          <div className="kanban-column-body">
                            {column.tasks.map((task) => (
                              <TaskCard
                                key={task.id}
                                task={task}
                                draggable
                                variant="board"
                                isDragging={draggingTaskId === task.id}
                                isSaving={movingTaskId === task.id}
                                onDragStateChange={setDraggingTaskId}
                                onSelect={openTask}
                              />
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state">Crea o selecciona un proyecto para ver su tablero.</p>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
