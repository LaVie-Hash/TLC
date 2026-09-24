const menuButton = document.querySelector('.menu-toggle');
const menu = document.querySelector('#main-nav');

menuButton?.addEventListener('click', () => {
  const opened = menu.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(opened));
  menuButton.setAttribute('aria-label', opened ? 'Menü schließen' : 'Menü öffnen');
});

menu?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  menu.classList.remove('open');
  menuButton?.setAttribute('aria-expanded', 'false');
}));

document.querySelector('#year').textContent = new Date().getFullYear();

const form = document.querySelector('#lead-form');
const feedback = document.querySelector('#form-feedback');
form?.addEventListener('submit', event => {
  event.preventDefault();
  const visitorName = new FormData(form).get('name').trim();
  feedback.textContent = `Danke${visitorName ? `, ${visitorName}` : ''}! Das Formular ist in dieser Demo noch nicht mit einem Postfach verbunden; es wurden keine Daten versendet oder gespeichert.`;
  feedback.classList.add('success');
});
