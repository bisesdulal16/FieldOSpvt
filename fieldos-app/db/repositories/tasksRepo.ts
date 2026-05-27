import { query, mutate, insertAndGetId } from '../database';

/**
 * Tasks Repository — CRUD for the tasks table.
 */

export async function getTasksByDate(date: string): Promise<any[]> {
  return query('SELECT * FROM tasks WHERE task_date = ?', [date]);
}

export async function getTasksByStatus(status: string): Promise<any[]> {
  return query('SELECT * FROM tasks WHERE status = ?', [status]);
}

export async function getTasksByType(type: string): Promise<any[]> {
  return query('SELECT * FROM tasks WHERE task_type = ?', [type]);
}

export async function createTask(task: {
  client_id: number;
  task_type: string;
  task_date: string;
  priority: string;
  reason: string;
  amount: number;
}): Promise<number> {
  return insertAndGetId(
    `INSERT INTO tasks (client_id, task_type, task_date, priority, reason, amount, status, is_completed)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)`,
    [task.client_id, task.task_type, task.task_date, task.priority, task.reason, task.amount]
  );
}

export async function updateTaskStatus(id: number, status: string): Promise<void> {
  await mutate('UPDATE tasks SET status = ? WHERE id = ?', [status, id]);
}

export async function markTaskCompleted(id: number): Promise<void> {
  await mutate(
    `UPDATE tasks
     SET is_completed = 1,
         completed_at = datetime('now'),
         status = 'completed'
     WHERE id = ?`,
    [id]
  );
}
