require('conform').setup({
  default_format_opts = {
    lsp_format = 'fallback',
  },
  format_on_save = {
    timeout_ms = 1000,
    lsp_format = 'fallback',
  },
  formatters = {
    -- Keep Conform's built-in arguments and run the tools through mise.
    stylua = {
      command = 'mise',
      prepend_args = { 'exec', '--', 'stylua' },
    },
    prettier = {
      command = 'mise',
      prepend_args = { 'exec', '--', 'prettier' },
    },
    oxfmt = {
      command = 'mise',
      prepend_args = { 'exec', '--', 'oxfmt' },
    },
  },
  formatters_by_ft = {
    lua = { 'stylua' },
    -- markdown = { 'oxfmt' },
    json = { 'prettier' },
  },
})
