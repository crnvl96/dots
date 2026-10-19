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
