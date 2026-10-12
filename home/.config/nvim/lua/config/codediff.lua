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
