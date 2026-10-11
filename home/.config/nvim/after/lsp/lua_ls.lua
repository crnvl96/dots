return {
  -- cmd = { 'mise', 'exec', 'lua-language-server@3.19', '--', 'lua-language-server' },
  settings = {
    Lua = {
      runtime = {
        version = 'LuaJIT',
      },
      diagnostics = {
        globals = {
          'vim',
          'MiniPick',
          'MiniFiles',
          'MiniExtra',
        },
      },
      workspace = {
        checkThirdParty = false,
        library = {
          vim.env.VIMRUNTIME,
          vim.fn.stdpath('config'),
        },
      },
      telemetry = { enable = false },
    },
  },
}
