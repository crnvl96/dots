vim.lsp.enable({ 'gopls', 'tsc', 'lua_ls', 'rust_analyzer' })

vim.keymap.set('n', 'K', '<Cmd>lua vim.lsp.buf.hover()<CR>', { desc = 'Hover symbol' })
vim.keymap.set('i', '<C-k>', '<Cmd>lua vim.lsp.buf.signature_help()<CR>', { desc = 'Signature help' })
vim.keymap.set('n', 'E', '<Cmd>lua vim.diagnostic.open_float()<CR>', { desc = 'Hover diagnostic' })
