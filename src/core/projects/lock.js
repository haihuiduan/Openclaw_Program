const projectLocks = new Map();

function withProjectLock(projectId, operation) {
  const previous = projectLocks.get(projectId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const tail = current.catch(() => {});
  projectLocks.set(projectId, tail);

  return current.finally(() => {
    if (projectLocks.get(projectId) === tail) {
      projectLocks.delete(projectId);
    }
  });
}

module.exports = { withProjectLock };
