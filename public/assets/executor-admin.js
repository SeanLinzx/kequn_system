(function () {
  const DEFAULT_PASSWORD = "user123";

  async function saveExecutor({ editId, name, email, password, storeIds }) {
    const body = { name, email };
    if (password) body.password = password;
    if (Array.isArray(storeIds)) body.storeIds = storeIds;
    if (editId) {
      await FenqunAPI.api("/executors/" + editId, { method: "PUT", body });
    } else {
      await FenqunAPI.api("/executors", { method: "POST", body });
    }
  }

  async function deleteExecutor(id) {
    await FenqunAPI.api("/executors/" + id, { method: "DELETE" });
  }

  window.ExecutorAdmin = {
    DEFAULT_PASSWORD,
    saveExecutor,
    deleteExecutor,
  };
})();
