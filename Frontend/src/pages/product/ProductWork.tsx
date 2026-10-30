import { TaskBoard } from '../../components/work/TaskBoard';
import { useWork } from '../../contexts/WorkContext';
import { useProductTab, textMatch } from '../../hooks/useProductTab';

export function ProductWork() {
  const { product, filters } = useProductTab();
  const { tasks } = useWork();
  const list = tasks.filter(
    (t) =>
      t.product === product.id &&
      textMatch(filters.q, t.key, t.title) &&
      (!filters.person || t.assignee === filters.person) &&
      (!filters.priority || t.priority === filters.priority) &&
      (!filters.status || t.status === filters.status),
  );
  return <TaskBoard tasks={list} />;
}
