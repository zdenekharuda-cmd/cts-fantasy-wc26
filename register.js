const form = document.getElementById('registerForm');
const message = document.getElementById('message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  message.textContent = 'Creating account...';
  message.style.color = '#2e7d32';

  const data = Object.fromEntries(new FormData(form).entries());

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Registration failed');
    }

    window.location.href = '/tips.html';
  } catch (error) {
    message.textContent = error.message || 'Request failed';
    message.style.color = '#b00020';
  }
});
