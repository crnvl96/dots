vim.api.nvim_create_autocmd('TextYankPost', {
  callback = function() vim.highlight.on_yank() end,
  desc = 'Highlight yanked text',
})

vim.api.nvim_create_autocmd('VimEnter', {
  callback = function() end,
  desc = 'Follow the macos current appearance',
})
