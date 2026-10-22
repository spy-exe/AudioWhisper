import uuid
from test_workspace_projects import seed


def test_overview_uses_real_project_records_tasks_and_explicit_local_date(client):
    project = f"Central-{uuid.uuid4().hex}"
    seed(project)
    client.post("/api/tasks", json={"title": "Alerta vencido", "project": project, "due_date": "2026-10-20"})
    task = client.post("/api/tasks", json={"title": "Relatório feito", "project": project, "due_date": "2026-10-19"}).json()
    client.patch(f"/api/tasks/{task['id']}", json={"status": "done", "revision": 1})
    response = client.get("/api/workspace", params={"project": project, "today": "2026-10-21"})
    assert response.status_code == 200
    result = response.json()
    assert result["recording_count"] == 1 and result["duration_seconds"] == 120
    assert result["task_counts"] == {"open": 1, "doing": 0, "done": 1}
    assert result["overdue_count"] == 1 and len(result["due_tasks"]) == 1
    assert result["recent"]["total"] == 1
