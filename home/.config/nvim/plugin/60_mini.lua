-- Mini.nvim

require('mini.extra').setup()
require('mini.icons').setup()

require('mini.statusline').setup()
require('mini.statuscolumn').setup()

require('mini.align').setup()
require('mini.splitjoin').setup()
require('mini.surround').setup()

require('mini.surround').setup({
  mappings = {
    add = 'sa',
    delete = 'sd',
    replace = 'sr',
    find = '',
    find_left = '',
    highlight = '',
    suffix_last = '',
    suffix_next = '',
  },
})

require('mini.snippets').setup({
  snippets = {
    require('mini.snippets').gen_loader.from_file('~/.config/nvim/snippets/global.json'),
    require('mini.snippets').gen_loader.from_lang(),
  },
})

-- Include hidden files in MiniPick's rg-backed grep searches.
vim.env.RIPGREP_CONFIG_PATH = vim.fn.stdpath('config') .. '/ripgreprc'
require('mini.pick').setup()

-- Use fd for files, including hidden files but excluding .git directories.
---@diagnostic disable-next-line: duplicate-set-field
MiniPick.registry.files = function()
  return MiniPick.builtin.cli({
    command = { 'fd', '--type=f', '--hidden', '--exclude=.git', '--color=never' },
  }, {
    source = {
      name = 'Files (fd)',
      show = function(buf_id, items, query) MiniPick.default_show(buf_id, items, query, { show_icons = true }) end,
    },
  })
end

-- stylua: ignore start
vim.keymap.set('n', '<Leader>ff', '<Cmd>Pick files<CR>', { desc = 'Find files' })
vim.keymap.set('n', '<Leader>fg', '<Cmd>lua MiniPick.builtin.grep_live()<CR>', { desc = 'Live grep' })
vim.keymap.set('n', '<Leader>fb', '<Cmd>lua MiniPick.builtin.buffers()<CR>', { desc = 'Find buffers' })
vim.keymap.set('n', '<Leader>fh', '<Cmd>lua MiniPick.builtin.help()<CR>', { desc = 'Find help' })
vim.keymap.set('n', '<Leader>fl', "<Cmd>lua MiniExtra.pickers.buf_lines({ scope = 'current' })<CR>", { desc = 'Buffer lines' })
vim.keymap.set('n', '<Leader>fo', '<Cmd>lua MiniExtra.pickers.oldfiles()<CR>', { desc = 'Old files' })
vim.keymap.set('n', '<Leader>fd', "<Cmd>lua MiniExtra.pickers.diagnostic({ scope = 'all' })<CR>", { desc = 'Diagnostics' })
vim.keymap.set('n', '<Leader>fk', '<Cmd>lua MiniExtra.pickers.keymaps()<CR>', { desc = 'Keymaps' })
vim.keymap.set('n', '<Leader>ld', "<Cmd>lua MiniExtra.pickers.lsp({ scope = 'definition' })<CR>", { desc = 'LSP definitions' })
vim.keymap.set('n', '<Leader>ls', "<Cmd>lua MiniExtra.pickers.lsp({ scope = 'document_symbol' })<CR>", { desc = 'LSP document symbols' })
vim.keymap.set('n', '<Leader>lS', "<Cmd>lua MiniExtra.pickers.lsp({ scope = 'workspace_symbol' })<CR>", { desc = 'LSP workspace symbols' })
vim.keymap.set('n', '<Leader>li', "<Cmd>lua MiniExtra.pickers.lsp({ scope = 'implementation' })<CR>", { desc = 'LSP implementations' })
vim.keymap.set('n', '<Leader>lr', "<Cmd>lua MiniExtra.pickers.lsp({ scope = 'references' })<CR>", { desc = 'LSP references' })
vim.keymap.set('n', '<Leader>lt', "<Cmd>lua MiniExtra.pickers.lsp({ scope = 'type_definition' })<CR>", { desc = 'LSP type definitions' })
-- stylua: ignore end

require('mini.files').setup({
  mappings = {
    go_in_plus = '<CR>',
    go_out_plus = '-',
    go_in = '',
    go_out = '',
  },
  windows = {
    max_number = math.huge,
    preview = true,
    width_focus = 50,
    width_nofocus = 15,
    width_preview = 80,
  },
})
-- stylua: ignore start
vim.keymap.set('n', '<Leader>ef', '<Cmd>lua MiniFiles.open()<CR>', { desc = 'Toggle file explorer' })
vim.keymap.set('n', '<Leader>ee', '<Cmd>lua MiniFiles.open(vim.api.nvim_buf_get_name(0))<CR>', { desc = 'Toggle file explorer (Here)' })
-- stylua: ignore end

local ai = require('mini.ai')
ai.setup({
  custom_textobjects = {
    g = MiniExtra.gen_ai_spec.buffer(),
    f = ai.gen_spec.treesitter({
      a = '@function.outer',
      i = '@function.inner',
    }),
  },
  search_method = 'cover',
})

require('mini.indentscope').setup({
  options = {
    border = 'both',
    indent_at_cursor = true,
    n_lines = 10000,
    try_as_border = true,
  },
  symbol = '╎',
})

local miniclue = require('mini.clue')
miniclue.setup({
  triggers = {
    { mode = { 'n', 'x' }, keys = '<Leader>' },
    { mode = 'n', keys = '[' },
    { mode = 'n', keys = ']' },
    { mode = 'i', keys = '<C-x>' },
    { mode = { 'n', 'x' }, keys = 'g' },
    { mode = { 'n', 'x' }, keys = "'" },
    { mode = { 'n', 'x' }, keys = '`' },
    { mode = { 'n', 'x' }, keys = '"' },
    { mode = { 'i', 'c' }, keys = '<C-r>' },
    { mode = 'n', keys = '<C-w>' },
    { mode = { 'n', 'x' }, keys = 'z' },
  },
  clues = {
    { mode = 'n', keys = '<Leader>d', desc = '+Diff' },
    { mode = 'n', keys = '<Leader>e', desc = '+Explorer' },
    { mode = 'n', keys = '<Leader>f', desc = '+Find' },
    { mode = 'n', keys = '<Leader>l', desc = '+LSP' },
    { mode = { 'n', 'x' }, keys = '<Leader>u', desc = '+UI' },
    { mode = 'n', keys = '<Leader>w', desc = '+Window' },
    miniclue.gen_clues.square_brackets(),
    miniclue.gen_clues.builtin_completion(),
    miniclue.gen_clues.g(),
    miniclue.gen_clues.marks(),
    miniclue.gen_clues.registers(),
    miniclue.gen_clues.windows(),
    miniclue.gen_clues.z(),
  },
  window = {
    delay = 1000,
    config = {
      width = 'auto',
    },
  },
})
