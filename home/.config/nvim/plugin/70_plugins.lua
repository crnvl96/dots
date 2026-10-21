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
