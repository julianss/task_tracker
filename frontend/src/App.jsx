import { useEffect, useMemo, useState } from "react";

const STATUSES = [
  { value: "todo", label: "Por hacer" },
  { value: "in_progress", label: "En progreso" },
  { value: "blocked", label: "Bloqueada" },
  { value: "done", label: "Hecha" },
];

const emptyTaskForm = {
  project_id: "",
  description: "",
  status: "todo",
};

function statusLabel(status) {
  return STATUSES.find((item) => item.value === status)?.label ?? status;
}

function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function formatProgress(task) {
  return typeof task.progress_percent === "number" ? `${task.progress_percent}%` : null;
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

function formatAuditAction(entry) {
  const actor = entry.username || "Usuario desconocido";
  return `${actor} · ${entry.details}`;
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

function ProjectModal({ open, projectName, creatingProject, onClose, onChange, onSubmit }) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Agregar proyecto</h2>
            <p>Ingresa el nombre del nuevo proyecto.</p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Cerrar
          </button>
        </div>
        <form className="stacked-form" onSubmit={onSubmit}>
          <input
            type="text"
            placeholder="Nombre del proyecto"
            value={projectName}
            onChange={(event) => onChange(event.target.value)}
            required
            autoFocus
          />
          <button type="submit" disabled={creatingProject}>
            {creatingProject ? "Creando..." : "Crear proyecto"}
          </button>
        </form>
      </section>
    </div>
  );
}

function TaskCard({
  task,
  onSelect,
  draggable = false,
  variant = "list",
  isDragging = false,
  onDragStateChange,
}) {
  const isList = variant === "list";

  return (
    <article
      className={`task-card task-card-${variant} ${isDragging ? "is-dragging" : ""}`}
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
        <span className="project-name">{task.project_name}</span>
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
        {formatProgress(task) ? <span>{formatProgress(task)} completado</span> : null}
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
}) {
  const [commentBody, setCommentBody] = useState("");
  const [commentFiles, setCommentFiles] = useState([]);
  const [taskFiles, setTaskFiles] = useState([]);
  const [checklistBody, setChecklistBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingTaskFiles, setUploadingTaskFiles] = useState(false);
  const [savingChecklistItem, setSavingChecklistItem] = useState(false);

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

  return (
    <section className="detail-panel detail-panel-full">
      <div className="detail-panel-header">
        <div className="detail-panel-title">
          <p className="detail-project-name">{task.project_name}</p>
          <h2>Tarea #{task.id}</h2>
          <p className="detail-task-meta">
            {task.comments.length} comentarios · {task.attachments.length} archivos
            {progress ? ` · ${progress} completado` : ""}
          </p>
        </div>
        <div className="detail-panel-actions">
          <a className="ghost-button" href={permalink}>
            Enlace permanente
          </a>
          <button className="ghost-button" onClick={onBack}>
            Volver
          </button>
        </div>
      </div>
      <div className="detail-section detail-section-summary">
        <div className="detail-status-row">
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
        </div>
        <p>{task.description}</p>
      </div>
      <div className="detail-section">
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
      <div className="detail-section">
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
      <div className="detail-section">
        <h3>Historial de cambios</h3>
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
      </div>
      <div className="detail-section">
        <h3>Comentarios</h3>
        <div className="comment-list">
          {task.comments.length ? (
            task.comments.map((comment) => (
              <article key={comment.id} className="comment-card">
                <div className="comment-meta">
                  <strong>{comment.username || "Usuario desconocido"}</strong>
                  <small>{new Date(comment.created_at).toLocaleString("es-MX")}</small>
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
      </div>
    </section>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [board, setBoard] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(() => getSelectedTaskIdFromLocation());
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedTaskLoading, setSelectedTaskLoading] = useState(false);
  const [view, setView] = useState("list");
  const [filters, setFilters] = useState({ q: "", project_id: "", status: "" });
  const [taskForm, setTaskForm] = useState(emptyTaskForm);
  const [taskFiles, setTaskFiles] = useState([]);
  const [projectName, setProjectName] = useState("");
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingTask, setSavingTask] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [error, setError] = useState("");

  const selectedProjectId = filters.project_id || projects[0]?.id || "";

  const requireAuth = () => {
    if (currentUser) return true;
    setError("Debes iniciar sesion para modificar datos");
    return false;
  };

  const loadCurrentUser = async () => {
    setAuthLoading(true);
    try {
      const data = await parseResponse(await fetch("/api/auth/me"));
      setCurrentUser(data.user);
      return data.user;
    } finally {
      setAuthLoading(false);
    }
  };

  const loadProjects = async () => {
    const data = await parseResponse(await fetch("/api/projects"));
    setProjects(data);
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
      const data = await parseResponse(await fetch(`/api/tasks/${taskId}`));
      setSelectedTask(data);
      return data;
    } finally {
      setSelectedTaskLoading(false);
    }
  };

  const loadTasks = async (nextFilters = filters) => {
    const params = new URLSearchParams();
    if (nextFilters.q) params.set("q", nextFilters.q);
    if (nextFilters.project_id) params.set("project_id", nextFilters.project_id);
    if (nextFilters.status) params.set("status", nextFilters.status);
    const suffix = params.toString();
    const data = await parseResponse(await fetch(`/api/tasks${suffix ? `?${suffix}` : ""}`));
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
    const data = await parseResponse(await fetch(`/api/projects/${projectId}/board`));
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
      const loadedProjects = await loadProjects();
      const effectiveProjectId = nextProjectId || loadedProjects[0]?.id || "";
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
  }, [filters.q, filters.project_id, filters.status]);

  useEffect(() => {
    loadBoard(selectedProjectId).catch((nextError) => setError(nextError.message));
  }, [selectedProjectId]);

  useEffect(() => {
    if (filters.project_id) {
      setTaskForm((current) => ({ ...current, project_id: filters.project_id }));
    }
  }, [filters.project_id]);

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

  const createProject = async (event) => {
    event.preventDefault();
    if (!requireAuth()) return;
    setCreatingProject(true);
    setError("");
    try {
      const project = await parseResponse(
        await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: projectName }),
        }),
      );
      setProjectName("");
      const nextProjects = [...projects, project].sort((a, b) => a.name.localeCompare(b.name));
      setProjects(nextProjects);
      setFilters((current) => ({ ...current, project_id: String(project.id) }));
      setTaskForm((current) => ({ ...current, project_id: String(project.id) }));
      setIsProjectModalOpen(false);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setCreatingProject(false);
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
        await fetch("/api/tasks", {
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
      await refreshAll(filters, filters.project_id || createdTask.project_id);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSavingTask(false);
    }
  };

  const updateTaskStatus = async (taskId, status) => {
    if (!requireAuth()) return;
    setError("");
    try {
      await parseResponse(
        await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }),
      );
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
      await fetch(`/api/tasks/${taskId}/comments`, {
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
      await fetch(`/api/tasks/${taskId}/attachments`, {
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
        await fetch(`/api/attachments/${attachmentId}`, {
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
        await fetch(`/api/tasks/${taskId}/checklist`, {
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
        await fetch(`/api/checklist-items/${itemId}`, {
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
        await fetch(`/api/checklist-items/${itemId}`, {
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
        await fetch("/api/auth/login", {
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
        await fetch("/api/auth/logout", {
          method: "POST",
        }),
      );
      setCurrentUser(null);
      setSelectedTaskId(null);
      setSelectedTask(null);
      setBoard(null);
      setTasks([]);
      setProjects([]);
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
        projectName={projectName}
        creatingProject={creatingProject}
        onClose={() => {
          if (creatingProject) return;
          setIsProjectModalOpen(false);
        }}
        onChange={setProjectName}
        onSubmit={createProject}
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
            <select
              value={filters.project_id}
              onChange={(event) => setFilters((current) => ({ ...current, project_id: event.target.value }))}
            >
              <option value="">Todos los proyectos</option>
              {projectOptions.map((project) => (
                <option key={project.value} value={project.value}>
                  {project.label}
                </option>
              ))}
            </select>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="">Todos los estados</option>
              {STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
            <div className="view-switch">
              <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
                Lista
              </button>
              <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>
                Kanban
              </button>
            </div>
          </div>
          <div className="toolbar-actions">
            <div className="project-form">
              <button type="button" onClick={() => setIsProjectModalOpen(true)}>
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
        className={`layout ${view === "board" ? "layout-board" : ""} ${selectedTaskId ? "layout-task-open" : ""}`}
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
                <>
                  <div className="panel-header">
                    <h2>Lista de tareas</h2>
                    <span>{tasks.length} tareas coinciden</span>
                  </div>
                  <div className="task-list">
                    {tasks.length ? (
                      tasks.map((task) => (
                        <TaskCard key={task.id} task={task} onSelect={openTask} variant="list" />
                      ))
                    ) : (
                      <p className="empty-state">Ninguna tarea coincide con los filtros actuales.</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="panel-header">
                    <h2>Kanban del proyecto</h2>
                    <span>{board?.project?.name || "Elige un proyecto"}</span>
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
