-- Plugin bootstrap

vim.api.nvim_create_autocmd('PackChanged', {
  callback = function(event)
    local data = event.data
    if data.spec.name == 'nvim-treesitter' and vim.tbl_contains({ 'install', 'update' }, data.kind) then
      -- The hook can run before the plugin is loaded, especially when the
      -- lockfile is synchronized during the first vim.pack call.
      if vim.fn.exists(':TSUpdate') == 0 then vim.cmd.packadd('nvim-treesitter') end
      vim.cmd('TSUpdate')
    end
    if data.spec.name == 'blink.cmp' and vim.tbl_contains({ 'install', 'update' }, data.kind) then
      if not data.active then
        vim.cmd.packadd('blink.lib')
        vim.cmd.packadd('blink.cmp')
      end

      require('blink.cmp').build():pwait()
    end
  end,
  desc = 'Run plugin update hooks',
})

vim.pack.add({
  'https://github.com/nvim-mini/mini.nvim',
  'https://github.com/tpope/vim-fugitive',
  'https://github.com/esmuellert/codediff.nvim',
  'https://github.com/nvim-treesitter/nvim-treesitter',
  'https://github.com/nvim-treesitter/nvim-treesitter-textobjects',
  'https://github.com/neovim/nvim-lspconfig',
  'https://github.com/stevearc/conform.nvim',
  'https://github.com/saghen/blink.lib',
  'https://github.com/saghen/blink.cmp',
  'https://github.com/meanderingprogrammer/render-markdown.nvim',
})

-- Appearance

local timer, pending
local stopped = false

-- Rosé Pine colors: https://rosepinetheme.com/palette
local palettes = {
  light = {
    name = 'minihues-light',
    colors = {
      base = '#faf4ed',
      surface = '#fffaf3',
      overlay = '#f2e9e1',
      muted = '#9893a5',
      subtle = '#797593',
      text = '#464261',
      love = '#b4637a',
      gold = '#ea9d34',
      rose = '#d7827e',
      pine = '#286983',
      foam = '#56949f',
      iris = '#907aa9',
      highlight_low = '#f4ede8',
      highlight_med = '#dfdad9',
      highlight_high = '#cecacd',
    },
  },
  dark = {
    name = 'minihues-dark',
    colors = {
      base = '#191724',
      surface = '#1f1d2e',
      overlay = '#26233a',
      muted = '#6e6a86',
      subtle = '#908caa',
      text = '#e0def4',
      love = '#eb6f92',
      gold = '#f6c177',
      rose = '#ebbcba',
      pine = '#31748f',
      foam = '#9ccfd8',
      iris = '#c4a7e7',
      highlight_low = '#21202e',
      highlight_med = '#403d52',
      highlight_high = '#524f67',
    },
  },
}

local function blend(fg, bg, alpha)
  local function channel(hex, i) return tonumber(hex:sub(i, i + 1), 16) end
  local function mix(i) return math.floor(alpha * channel(fg, i) + (1 - alpha) * channel(bg, i) + 0.5) end
  return string.format('#%02x%02x%02x', mix(2), mix(4), mix(6))
end

-- Start from the generated MiniHues palette and swap in Rosé Pine colors.
-- Diff and other tinted backgrounds blend the accent into the base.
local function make_palette(c)
  local p = require('mini.hues').make_palette({
    background = c.base,
    foreground = c.text,
  })

  local hues = {
    red = c.love,
    orange = c.rose,
    yellow = c.gold,
    green = c.foam,
    cyan = c.foam,
    azure = c.pine,
    blue = c.pine,
    purple = c.iris,
    accent = c.iris,
  }
  for hue, color in pairs(hues) do
    p[hue], p[hue .. '_bg'] = color, blend(color, c.base, 0.2)
  end
  p.bg_edge, p.bg_mid, p.bg_mid2 = c.surface, c.highlight_low, c.highlight_med
  p.fg_mid, p.fg_mid2 = c.subtle, c.muted
  return p
end

-- Syntax roles follow rose-pine.nvim rather than MiniHues defaults.
local function highlights(c)
  return {
    Boolean = { fg = c.rose },
    Changed = { fg = c.rose },
    Comment = { fg = c.muted, italic = true },
    Constant = { fg = c.gold },
    Delimiter = { fg = c.subtle },
    Function = { fg = c.rose },
    Identifier = { fg = c.text },
    LineNr = { fg = c.muted },
    Operator = { fg = c.subtle },
    PreProc = { fg = c.iris },
    Special = { fg = c.foam },
    Statement = { fg = c.pine, bold = true },
    String = { fg = c.gold },
    Type = { fg = c.foam },
    diffChanged = { fg = c.rose },
    ['@variable.builtin'] = { fg = c.love, bold = true },
    ['@variable.member'] = { fg = c.foam },
    ['@variable.parameter'] = { fg = c.iris, italic = true },
  }
end

local function observe(result)
  if result.signal ~= 0 then return end
  local stdout, stderr = vim.trim(result.stdout or ''), result.stderr or ''
  if result.code == 0 then
    if stdout == 'Dark' then return 'dark' end
    if stdout == 'Light' then return 'light' end
  elseif result.code == 1 and stdout == '' and stderr:find('AppleInterfaceStyle', 1, true) then
    if stderr:find('Could not find key', 1, true) or stderr:find('does not exist', 1, true) then return 'light' end
  end
end

local function refresh()
  if stopped or not timer or pending then return end
  local ok, process = pcall(
    vim.system,
    { '/usr/bin/defaults', 'read', '-g', 'AppleInterfaceStyle' },
    { text = true, timeout = 1000, env = { LC_ALL = 'C' } },
    vim.schedule_wrap(function(result)
      pending = nil
      if stopped then return end
      local appearance = observe(result)
      local theme = palettes[appearance]
      if not theme or vim.g.colors_name == theme.name then return end
      -- Avoid reloading the old colorscheme when changing 'background'. Restore
      -- its name so MiniHues still clears the old highlights when applying.
      local previous = vim.g.colors_name
      vim.g.colors_name = nil
      vim.o.background = appearance
      vim.g.colors_name = previous
      require('mini.hues').apply_palette(make_palette(theme.colors))
      for group, spec in pairs(highlights(theme.colors)) do
        vim.api.nvim_set_hl(0, group, spec)
      end
      require('mini.colors').setup()
      local cs = require('mini.colors').get_colorscheme()
      cs:add_transparency({
        float = true,
        statuscolumn = true,
        statusline = true,
        tabline = true,
        winbar = true,
      }):apply()
      vim.g.colors_name = theme.name
    end)
  )
  if ok then pending = process end
end

if stopped or timer or vim.fn.has('macunix') ~= 1 then return end

timer = assert(vim.uv.new_timer())
vim.api.nvim_create_autocmd('VimLeavePre', {
  group = vim.api.nvim_create_augroup('MacosAppearance', {}),
  once = true,
  callback = function()
    stopped = true
    timer:stop()
    timer:close()
    if pending then pcall(pending.kill, pending, 9) end
    pending = nil
  end,
})

timer:start(2000, 2000, vim.schedule_wrap(refresh))

refresh()

-- Editor options

vim.g.mapleader = ' '

vim.o.mouse = 'a'
vim.o.mousescroll = 'ver:1,hor:3'
vim.o.undofile = true
vim.o.autoread = true
vim.o.clipboard = 'unnamedplus'

vim.o.swapfile = false
vim.o.undofile = true

vim.o.breakindent = true
vim.o.cursorline = true
vim.o.foldenable = false
vim.o.linebreak = true
vim.o.number = true
vim.o.relativenumber = true
vim.o.signcolumn = 'yes'
vim.o.spell = false
vim.o.splitbelow = true
vim.o.splitkeep = 'screen'
vim.o.splitright = true
vim.o.wrap = false

vim.o.autoindent = true
vim.o.expandtab = true
vim.o.ignorecase = true
vim.o.incsearch = true
vim.o.infercase = true
vim.o.shiftwidth = 2
vim.o.smartcase = true
vim.o.smartindent = true
vim.o.tabstop = 2
vim.o.virtualedit = 'block'

vim.opt.fillchars:append({ eob = ' ' })

-- Keymaps

local function copy_file_location()
  local path = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(0), ':.')
  if path == '' then path = '[No Name]' end
  local mode = vim.fn.mode()
  local is_visual = mode == 'v' or mode == 'V' or mode == '\22'
  local start_line, end_line = vim.fn.line('.'), vim.fn.line('.')
  if is_visual then
    local region = vim.fn.getregionpos(vim.fn.getpos('v'), vim.fn.getpos('.'), { type = mode })
    start_line, end_line = region[1][1][2], region[#region][2][2]
  end
  local location = path .. ':' .. start_line
  if start_line ~= end_line then location = location .. '-' .. end_line end
  if vim.fn.has('clipboard') == 0 then
    vim.notify('Failed to copy file location: no clipboard provider', vim.log.levels.ERROR)
    return
  end
  local ok, result = pcall(vim.fn.setreg, '+', location, 'v')
  if not ok or result ~= 0 then
    vim.notify('Failed to copy file location: ' .. tostring(result), vim.log.levels.ERROR)
    return
  end
  if is_visual then vim.cmd.normal({ args = { '\27' }, bang = true }) end
  vim.notify('Copied ' .. location)
end

local scratch_buf, scratch_previous_buf

local function toggle_lua_scratch()
  local current_buf = vim.api.nvim_get_current_buf()
  if current_buf == scratch_buf then
    if scratch_previous_buf and vim.api.nvim_buf_is_valid(scratch_previous_buf) then
      vim.api.nvim_set_current_buf(scratch_previous_buf)
    else
      vim.notify('No previous buffer to return to', vim.log.levels.INFO)
    end
    return
  end

  if not scratch_buf or not vim.api.nvim_buf_is_valid(scratch_buf) then
    scratch_buf = vim.fn.bufadd('/tmp/scratch.lua')
    vim.fn.bufload(scratch_buf)
    vim.bo[scratch_buf].buflisted = true
    vim.bo[scratch_buf].bufhidden = 'hide'
    vim.bo[scratch_buf].filetype = 'lua'
    vim.keymap.set('n', '<Leader>ur', function()
      local code = table.concat(vim.api.nvim_buf_get_lines(scratch_buf, 0, -1, false), '\n')
      local chunk, err = loadstring(code, '@/tmp/scratch.lua')
      if chunk then
        local ok, result = pcall(chunk)
        if not ok then err = result end
      end
      if err then vim.notify(tostring(err), vim.log.levels.ERROR) end
    end, { buffer = scratch_buf, desc = 'Run Lua scratch buffer' })
  end

  vim.api.nvim_set_current_buf(scratch_buf)
  scratch_previous_buf = current_buf
end

vim.keymap.set({ 'n', 'v', 'i', 'o' }, '<Esc>', '<Esc><Cmd>noh<CR>', { desc = 'Clear highlights' })

vim.keymap.set('x', 'p', 'P', { desc = 'Paste in visual mode' })

vim.keymap.set('c', '<C-a>', '<Home>', { desc = 'Move to start of command line' })
vim.keymap.set('c', '<C-e>', '<End>', { desc = 'Move to end of command line' })
vim.keymap.set('c', '<C-f>', '<Right>', { desc = 'Move forward one character' })
vim.keymap.set('c', '<M-h>', '<C-f>', { desc = 'Open command-line window' })
vim.keymap.set('c', '<C-b>', '<Left>', { desc = 'Move backward one character' })
vim.keymap.set('c', '<M-f>', '<C-Right>', { desc = 'Move forward one word' })
vim.keymap.set('c', '<M-b>', '<C-Left>', { desc = 'Move backward one word' })
vim.keymap.set('c', '<C-p>', '<S-Up>', { desc = 'Previous command in history' })
vim.keymap.set('c', '<C-n>', '<S-Down>', { desc = 'Next command in history' })
vim.keymap.set('c', '<C-u>', '<End><C-u>', { desc = 'Delete entire command line' })
vim.keymap.set('c', '<C-w>', '<C-w>', { desc = 'Delete previous word' })

vim.keymap.set('n', '<C-h>', '<C-w>h', { desc = 'Move to the left window' })
vim.keymap.set('n', '<C-j>', '<C-w>j', { desc = 'Move to the lower window' })
vim.keymap.set('n', '<C-k>', '<C-w>k', { desc = 'Move to the upper window' })
vim.keymap.set('n', '<C-l>', '<C-w>l', { desc = 'Move to the right window' })
vim.keymap.set('n', 'Y', 'yg_', { desc = 'Yank to end of line' })
vim.keymap.set('n', '<C-d>', '<C-d>zz', { desc = 'Scroll down and center' })
vim.keymap.set('n', '<C-u>', '<C-u>zz', { desc = 'Scroll up and center' })

vim.keymap.set('n', '<Leader>wv', '<C-w>v', { desc = 'Split window vertically' })
vim.keymap.set('n', '<Leader>ws', '<C-w>s', { desc = 'Split window horizontally' })
vim.keymap.set('n', '<Leader>wH', '<C-w>H', { desc = 'Move window to the far left' })
vim.keymap.set('n', '<Leader>wJ', '<C-w>J', { desc = 'Move window to the bottom' })
vim.keymap.set('n', '<Leader>wK', '<C-w>K', { desc = 'Move window to the top' })
vim.keymap.set('n', '<Leader>wL', '<C-w>L', { desc = 'Move window to the far right' })
vim.keymap.set('n', '<Leader>wo', '<C-w>o', { desc = 'Close other windows' })
vim.keymap.set('n', '<Leader>wc', '<C-w>c', { desc = 'Close current window' })
vim.keymap.set('n', '<Leader>wx', '<C-w>x', { desc = 'Exchange current window' })

vim.keymap.set('n', '<Leader>us', toggle_lua_scratch, { desc = 'Toggle Lua scratch buffer' })
vim.keymap.set('n', '<Leader>uw', '<Cmd>setlocal wrap!<CR>', { desc = 'Toggle linewrap' })
vim.keymap.set({ 'n', 'x' }, '<Leader>ul', copy_file_location, { desc = 'Copy file location' })

vim.keymap.set('n', '<Leader>uc', function()
  vim.cmd([[G add .]])
  vim.cmd([[G commit --amend --no-edit]])
  vim.cmd([[G push --force-with-lease]])
end, { desc = 'Amend commit without changing message' })

-- Autocommands

vim.api.nvim_create_autocmd('TextYankPost', {
  callback = function() vim.highlight.on_yank() end,
  desc = 'Highlight yanked text',
})

vim.api.nvim_create_autocmd('VimEnter', {
  callback = function() end,
  desc = 'Follow the macos current appearance',
})

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

-- Include hidden files in MiniPick's rg-backed file and grep searches.
vim.env.RIPGREP_CONFIG_PATH = vim.fn.stdpath('config') .. '/ripgreprc'
require('mini.pick').setup()
-- stylua: ignore start
vim.keymap.set('n', '<Leader>ff', '<Cmd>lua MiniPick.builtin.files()<CR>', { desc = 'Find files' })
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

-- CodeDiff

require('codediff').setup({
  keymaps = {
    view = {
      toggle_explorer = '<Leader>db',
      focus_explorer = '<Leader>de',
    },
  },
})

vim.keymap.set('n', '<Leader>dd', '<Cmd>CodeDiff<CR>', { desc = 'Diff working tree' })
vim.keymap.set('n', '<Leader>ds', '<Cmd>CodeDiff --staged<CR>', { desc = 'Diff staged changes' })
vim.keymap.set('n', '<Leader>df', '<Cmd>CodeDiff file HEAD<CR>', { desc = 'Diff current file against HEAD' })
vim.keymap.set('n', '<Leader>dh', '<Cmd>CodeDiff history<CR>', { desc = 'Diff commit history' })

-- LSP

vim.lsp.enable({ 'gopls', 'tsc', 'lua_ls', 'rust_analyzer' })

vim.keymap.set('n', 'K', '<Cmd>lua vim.lsp.buf.hover()<CR>', { desc = 'Hover symbol' })
vim.keymap.set('i', '<C-k>', '<Cmd>lua vim.lsp.buf.signature_help()<CR>', { desc = 'Signature help' })
vim.keymap.set('n', 'E', '<Cmd>lua vim.diagnostic.open_float()<CR>', { desc = 'Hover diagnostic' })

-- Tree-sitter

local languages = {
  'lua',
  'vimdoc',
  'markdown',
  'graphql',
  'git_config',
  'git_rebase',
  'gitattributes',
  'gitcommit',
  'gitignore',
  'go',
  'javascript',
  'typescript',
  'tsx',
  'make',
  'bash',
  'zsh',
}

require('nvim-treesitter').install(
  vim
    .iter(languages)
    :filter(function(language) return #vim.api.nvim_get_runtime_file('parser/' .. language .. '.*', false) == 0 end)
    :flatten()
    :totable()
)

vim.api.nvim_create_autocmd('FileType', {
  pattern = vim
    .iter(languages)
    :map(function(language) return vim.treesitter.language.get_filetypes(language) end)
    :flatten()
    :totable(),
  callback = function(event) vim.treesitter.start(event.buf) end,
  desc = 'Start tree-sitter',
})

-- Formatting

require('conform').setup({
  default_format_opts = {
    lsp_format = 'fallback',
  },
  format_on_save = {
    timeout_ms = 1000,
    lsp_format = 'fallback',
  },
  formatters_by_ft = {
    lua = { 'stylua' },
  },
})

-- Completion

local cmp = require('blink.cmp')

local function get_mini_icon(ctx)
  if ctx.source_name == 'Path' then
    local is_unknown_type =
      vim.tbl_contains({ 'link', 'socket', 'fifo', 'char', 'block', 'unknown' }, ctx.item.data.type)
    local mini_icon, mini_hl, _ =
      require('mini.icons').get(is_unknown_type and 'os' or ctx.item.data.type, is_unknown_type and '' or ctx.label)
    if mini_icon then return mini_icon, mini_hl end
  end
  local mini_icon, mini_hl, _ = require('mini.icons').get('lsp', ctx.kind)
  return mini_icon, mini_hl
end

cmp.setup({
  keymap = { preset = 'super-tab' },
  completion = {
    menu = {
      draw = {
        components = {
          kind_icon = {
            text = function(ctx)
              local kind_icon, _ = get_mini_icon(ctx)
              return kind_icon
            end,
            highlight = function(ctx)
              local _, hl = get_mini_icon(ctx)
              return hl
            end,
          },
          kind = {
            highlight = function(ctx)
              local _, hl = get_mini_icon(ctx)
              return hl
            end,
          },
        },
      },
    },
  },
  snippets = { preset = 'mini_snippets' },
  sources = { default = { 'lsp', 'path', 'snippets' } },
  cmdline = {
    enabled = true,
    keymap = { preset = 'inherit' },
    sources = { default = { 'cmdline', 'buffer', 'path' } },
    completion = {
      menu = { auto_show = true },
    },
  },
  fuzzy = { implementation = 'rust' },
})

-- Markdown

require('render-markdown').setup({
  code = {
    sign = false,
    width = 'block',
    right_pad = 1,
  },
  heading = {
    sign = false,
    icons = {},
  },
  checkbox = {
    enabled = false,
  },
})

vim.keymap.set('n', '<Leader>um', '<Cmd>lua require("render-markdown").toggle()<CR>', { desc = 'Toggle markdown UI' })
