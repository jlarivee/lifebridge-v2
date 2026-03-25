function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function fillChip(text) {
  var input = document.getElementById('workspaceInput');
  input.value = text;
  input.focus();
}
