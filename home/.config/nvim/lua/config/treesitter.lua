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
