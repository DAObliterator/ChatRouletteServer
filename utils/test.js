console.log("blue".toUpperCase())

let currentInterests = ["Netflix " , "Shows"];

let currentInterests_ = currentInterests.map((interest) => {
  return interest.trim().toUpperCase();
});

console.log(currentInterests_);