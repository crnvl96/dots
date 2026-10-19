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
