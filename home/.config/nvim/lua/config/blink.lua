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
