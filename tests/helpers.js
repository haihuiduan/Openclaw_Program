const path = require("node:path");

const root = path.resolve(__dirname, "..");

function projectPath(relativePath) {
  return path.join(root, relativePath);
}

function moduleId(relativePath) {
  return require.resolve(projectPath(relativePath));
}

function clearProjectModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(root + path.sep)) {
      delete require.cache[key];
    }
  }
}

function mockModule(relativePath, exports) {
  const id = moduleId(relativePath);
  require.cache[id] = {
    id,
    filename: id,
    loaded: true,
    exports
  };
}

async function captureConsole(fn) {
  const originalLog = console.log;
  const lines = [];

  console.log = (...args) => {
    lines.push(args.join(" "));
  };

  try {
    const result = await fn();
    return {
      output: lines.join("\n"),
      result
    };
  } finally {
    console.log = originalLog;
  }
}

module.exports = {
  captureConsole,
  clearProjectModules,
  mockModule,
  projectPath
};
