const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: form.elements.password.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '登录失败');
    form.elements.password.value = '';
    location.replace('/');
  } catch (error) {
    errorBox.textContent = error.message || '连接失败，请稍后重试';
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
  }
});
