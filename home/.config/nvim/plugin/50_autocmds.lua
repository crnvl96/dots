-- Autocommands

vim.api.nvim_create_autocmd('TextYankPost', {
  callback = function() vim.highlight.on_yank() end,
  desc = 'Highlight yanked text',
})
