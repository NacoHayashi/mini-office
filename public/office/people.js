// The online list and renaming yourself.
import { send } from "./net.js";
import { $, phoneQuery, state } from "./office-state.js";

export function personNamed(id) {
  if (state.me?.id === id) return state.me;
  return state.others.get(id) || null;
}

export function renderOnline() {
  const list = $("online-list");
  list.replaceChildren();
  const people = [];
  if (state.me) people.push(state.me);
  for (const other of state.others.values()) people.push(other);
  const count = String(people.length);
  for (const id of ["online-count", "online-total"]) {
    const node = $(id);
    if (node) node.textContent = count;
  }
  for (const person of people) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = person.displayName + (person.id === state.me?.id ? "（你）" : "");
    const id = document.createElement("small");
    id.textContent = `@${person.id}`;
    item.append(name, id);
    list.appendChild(item);
  }
}

export function closePeople() {
  document.body.classList.remove("people-open");
  $("people-btn")?.setAttribute("aria-expanded", "false");
  const form = $("rename-form");
  if (form?.classList.contains("rename-pop")) {
    form.hidden = true;
    form.classList.remove("rename-pop");
    $("online")?.appendChild(form);
  }
}

export function wirePeople() {
  $("rename").addEventListener("click", () => {
    const form = $("rename-form");
    const opening = form.hidden;
    form.hidden = !opening;
    if (!opening) {
      form.classList.remove("rename-pop");
      $("online")?.appendChild(form);
      return;
    }
    $("rename-input").value = state.me?.displayName || "";
    if (phoneQuery.matches) {
      closePeople();
      document.body.appendChild(form);
      form.classList.add("rename-pop");
      form.hidden = false;
    }
    $("rename-input").focus();
  });
  $("rename-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const displayName = $("rename-input").value.trim();
    if (!displayName) return;
    send({ t: "profile", displayName });
    closePeople();
    $("rename-form").hidden = true;
    $("rename-form").classList.remove("rename-pop");
    $("online")?.appendChild($("rename-form"));
  });
}
